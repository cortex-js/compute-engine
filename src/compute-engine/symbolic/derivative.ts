import { apply } from '../function-utils.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import { mul } from '../boxed-expression/arithmetic-mul-div.js';
import { mayBeMatrixValued } from '../boxed-expression/matrix-operand.js';
import { asSmallInteger } from '../boxed-expression/numerics.js';
import type {
  Expression,
  ExpressionInput,
  FunctionInterface,
  Scope,
} from '../global-types.js';
import { add } from '../boxed-expression/arithmetic-add.js';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isExpression,
  isDictionary,
  isAbsentSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  isDestructuringParameter,
} from '../boxed-expression/function-literal.js';
import {
  collectBinderNames,
  isOperatorDef,
} from '../boxed-expression/utils.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { isFoldingConstant } from '../boxed-expression/simplify.js';
import type { Type } from '../../common/type/types.js';
import {
  type AliasDescent,
  collectionElementType,
  isPointElementType,
  resolveTypeAlias,
  stripMissingFromType,
  typeContainsMissing,
  unfoldAliasOnDescent,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  boundVariableBindings,
  boundVariableNamesInOperand,
  rewriteWithBinders,
  sameBindingDef,
  valueDefinitionInContext,
} from '../boxed-expression/binders.js';
import {
  angularChainFactor,
  DIRECT_TRIG_OPERATORS,
  INVERSE_TRIG_OPERATORS,
} from './angular-unit.js';

/**
 * Maximum recursion depth for differentiation.
 *
 * This guards against pathological cases where differentiation rules
 * might loop indefinitely. Normal derivatives (including higher-order)
 * should never approach this limit.
 */
const MAX_DIFFERENTIATION_DEPTH = 100;

/**
 * Maximum size, in expression nodes, of a result the symbolic
 * differentiator will build.
 *
 * The differentiation rules duplicate their operands with no sharing —
 * `d/dx √u = u′/(2√u)` writes `u` twice — so each derivative order roughly
 * squares the tree of a deeply nested expression. A 12-deep nested radical
 * `√(x+√(x+…))` already has a second derivative of several million nodes:
 * minutes of work, gigabytes of allocation, and a result no one can read.
 *
 * Rather than present that as a hang, decline honestly: `differentiate()`
 * returns `undefined` as soon as the result it is assembling crosses this
 * budget, and the enclosing `D` / `Derivative` stays inert and symbolic —
 * the same convention a lazy operator uses to decline differentiation.
 *
 * Sizing. The largest derivative taken anywhere in the test suite is 798
 * nodes, a factor of 30 below this, and the budget still admits the biggest
 * nested-radical derivatives that complete in reasonable time (the 2nd
 * derivative of an 8-deep radical, ~17 500 nodes, 7 s).
 *
 * It is not set higher, because a refusal is BOUNDED work, not instant: the
 * differentiator has to build up to the budget before it can know it is over
 * it, and that build is superlinear. Measured on `√(x+√(x+…))`: at 25 000
 * nodes a 12-deep 2nd derivative declines in ~7 s and a 24-deep one in ~4 s,
 * where the same refusals at 100 000 take ~85 s and ~17 s — slower than the
 * unguarded blow-up they were meant to replace. A larger budget buys larger
 * admissible results and pays for them in refusal latency; this value is
 * where that trade sits.
 *
 * Real relief for the deeply-nested case needs sharing (a
 * let/common-subexpression representation) in the derivative itself, which
 * this guard does not attempt.
 *
 * Deliberately internal: a safety valve against pathological input, not a
 * tuning knob.
 */
const MAX_DERIVATIVE_NODES = 25_000;

/**
 * Node counts, memoized by expression identity. Boxed expressions are
 * immutable, and each differentiation rule reuses its operand instances in
 * the terms it builds, so measuring a result costs O(nodes newly built at
 * this step), not O(size of the result).
 */
const nodeCountCache = new WeakMap<Expression, number>();

/**
 * Distinct nodes measured since the current top-level differentiation
 * started — the memo above makes each node count exactly once, so this is
 * the number of nodes the differentiation has actually built.
 *
 * Result size alone is not enough to refuse *quickly*: the sum rule
 * differentiates each term separately (every term under budget) and only
 * exceeds the budget when the last one is added, by which point all the work
 * is done. The footprint grows term by term and trips in the middle.
 */
let differentiationFootprint = 0;

/**
 * The number of nodes in `expr`, saturating above `limit`: the value is
 * exact when it is `<= limit`, and merely "greater than `limit`" otherwise.
 * Saturating bounds a single measurement even when nothing is shared, and
 * keeps the count from overflowing on a heavily shared tree.
 */
function boundedNodeCount(expr: Expression, limit: number): number {
  const cached = nodeCountCache.get(expr);
  if (cached !== undefined) return cached;
  differentiationFootprint += 1;
  let n = 1;
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      n += boundedNodeCount(op, limit);
      if (n > limit) break;
    }
  }
  nodeCountCache.set(expr, n);
  return n;
}

// Set once a differentiation has exceeded `MAX_DERIVATIVE_NODES`. The
// recursion then unwinds by throwing `kOverBudget`, which every enclosing
// level lets pass: returning `undefined` instead would have each level run
// its own rule (`mul()`, `add()`, a `D(…)` placeholder for the operand that
// declined) over operands that are already enormous — the unwind alone cost
// more than the aborted differentiation. The sentinel never escapes: it is
// caught by the `depth === 0` frame, which is where every caller enters
// (including the re-entrant `expr.evaluate()` of a nested `D`), and turned
// back into the ordinary `undefined` decline.
const kOverBudget = Symbol('derivative-over-budget');
let differentiationOverBudget = false;
let differentiationNesting = 0;

/**
 * Whether a differentiation is running now. A differentiation that starts
 * while another one runs (the evaluation of a nested `D`) shares the size
 * budget of the enclosing one: it can decline only because the enclosing
 * differentiation has already built many nodes, and the same derivative
 * computed alone would close. A cache of declines does not record such a
 * decline.
 */
export function isDifferentiating(): boolean {
  return differentiationNesting > 0;
}

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
  if (!dependsOnVariable(child, v)) return ce.Zero;
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
  if (!trace || !dependsOnVariable(node, v)) return;
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
/**
 * The product of `factors` with the factor at `index` replaced by `replacement`
 * (its derivative), the other factors in their written order. The sort of
 * `mul()` is not used for the factors: the derivative of a function that was
 * declared to return `any` is typed `number`, and the sort would move it
 * before the matrix factors. The numbers are multiplied together and placed
 * first, as in a canonical product.
 */
function productWithFactorReplaced(
  ce: Expression['engine'],
  factors: ReadonlyArray<Expression>,
  index: number,
  replacement: Expression
): Expression {
  if (replacement.isSame(0)) return ce.Zero;
  const parts = [...factors];
  parts.splice(
    index,
    1,
    ...(isFunction(replacement, 'Multiply') ? replacement.ops : [replacement])
  );
  const numbers = parts.filter((x) => isNumber(x));
  const rest = parts.filter((x) => !isNumber(x));
  const coefficient = numbers.length > 0 ? mul(...numbers) : ce.One;
  if (coefficient.isSame(0)) return ce.Zero;
  const items = coefficient.isSame(1) ? rest : [coefficient, ...rest];
  return items.length === 1 ? items[0] : ce._fn('Multiply', items);
}

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
  Truncate: 0,
  Sign: 0,
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
  LogGamma: ['Digamma', '_'],
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
  // d/dx Ai(x) = Ai'(x); d/dx Bi(x) = Bi'(x)
  AiryAi: ['AiryAiPrime', '_'],
  AiryBi: ['AiryBiPrime', '_'],
  // From the Airy ODE y'' = x·y: d/dx Ai'(x) = x·Ai(x), d/dx Bi'(x) = x·Bi(x)
  AiryAiPrime: ['Multiply', '_', ['AiryAi', '_']],
  AiryBiPrime: ['Multiply', '_', ['AiryBi', '_']],
  // Note: Bessel functions (BesselJ, BesselY, BesselI, BesselK) have been
  // omitted from this table because their derivatives involve functions of
  // different orders (handled by a dedicated special-case block below). For
  // example, d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2.
  //
  // Similarly, Zeta, PolyGamma, and Beta derivatives are omitted because
  // they either don't have simple closed forms or involve the polygamma function
  // with varying orders.
};

/**
 * Scale a `DERIVATIVES_TABLE` formula for the engine's `angularUnit`.
 *
 * The table holds the RADIAN derivatives. In a non-radian unit, `Sin(x)`
 * denotes `sin(k·x)` (with `k = π/180` in degree mode), so its derivative
 * picks up the chain factor `k`; an inverse function returns an angle in the
 * current unit, so its derivative is divided by `k`. A no-op in radian mode
 * (and for every unit-independent head, hyperbolics included).
 *
 * The factor is EXACT (`π/180`, not `0.01745…`): the derivative is an
 * ordinary symbolic result and must not turn exact input into a float.
 */
function scaleForAngularUnit(
  formula: Expression,
  operator: string
): Expression {
  const ce = formula.engine;
  if (ce.angularUnit === 'rad') return formula;
  // `ce.function('Multiply'|'Divide', …)`, not `.mul()`/`.div()`: the
  // formula can be a sum, and `mul()` would distribute over it.
  if (DIRECT_TRIG_OPERATORS.has(operator))
    return ce.function('Multiply', [angularChainFactor(ce), formula]);
  if (INVERSE_TRIG_OPERATORS.has(operator))
    return ce.function('Divide', [formula, angularChainFactor(ce)]);
  return formula;
}

/**
 * The derivative of the unary function `operator` at `arg`, from the
 * derivative table, scaled for the engine's angular unit; `undefined` for a
 * head the table does not know. The formula is built with `subs()`, not
 * evaluated, so an exact `arg` keeps an exact derivative (`ln 10` stays
 * symbolic). A step function (`Floor`, `Ceil`, `Round`, `Truncate`, `Sign`)
 * has the derivative `0`: its slope is zero almost everywhere.
 *
 * Used by the error propagation of a `Measurement` operand
 * (`partialDerivative()`, `library/measurement-arithmetic.ts`): the
 * first-order uncertainty of `f(a ± σ)` is `|f′(a)|·σ`, and this is `f′(a)`.
 */
export function unaryDerivativeFormula(
  ce: Expression['engine'],
  operator: string,
  arg: Expression
): Expression | undefined {
  const h = DERIVATIVES_TABLE[operator as keyof typeof DERIVATIVES_TABLE] as
    ExpressionInput | undefined;
  if (h === undefined) return undefined;
  return scaleForAngularUnit(ce.expr(h).subs({ _: arg }), operator);
}

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
  const opDef = sym.operatorDefinition;
  if (opDef !== undefined) {
    // A BUILTIN — its definition owned by the system scope (compared by
    // scope identity, so a user definition SHADOWING a builtin name still
    // qualifies) — is not a user function: applying it to wildcard symbols
    // and evaluating is at best a no-op, and for control structures it runs
    // an evaluate handler on nonsense operands (`Which(_1, …)` throws on a
    // non-boolean condition; `Loop(_1)` would spin until the deadline).
    //
    // A caller-supplied library (the constructor's `libraries` option) is
    // installed in the system scope too, so the scope test cannot tell its
    // operators from the builtins. The engine records their names in
    // `_customLibraryOperators`: such an operator is a user function, as it
    // is when it is declared with `ce.declare()`. A library loaded later with
    // `ce.loadLibrary()` is installed in the global scope, so the scope test
    // below already classifies its operators as user functions.
    if (!isSymbol(sym)) return true;
    if (sym.engine._customLibraryOperators.has(sym.symbol)) return true;
    const systemScope = sym.engine.contextStack[0]?.lexicalScope;
    const systemDef = systemScope?.bindings.get(sym.symbol);
    if (isOperatorDef(systemDef) && systemDef.operator === opDef) return false;
    // A copy or an extension of the builtin definition that keeps its
    // `evaluate`, `canonical`, `compile` and `derivative` handlers, its
    // `lazy` and `broadcastable` flags and its `evaluateAsync` handler is the
    // builtin too (`shadowsLibraryName()`, `library-shadowing.ts`).
    if (isOperatorDef(systemDef) && !shadowsLibraryName(sym.engine, sym.symbol))
      return false;
    return true;
  }
  const value = sym.valueDefinition?.value;
  return value !== undefined && isFunction(value, 'Function');
}

/**
 * The function literal that defines the user function `fn`, or `undefined`
 * when it has none. A symbol declared with a function type and then assigned
 * a `Function` literal holds the literal as its value; a definition
 * `f(x) := …` keeps it on its operator definition (`_lambdaLiteral`).
 */
function userFunctionLiteral(fn: Expression): Expression | undefined {
  const value = fn.valueDefinition?.value;
  if (value !== undefined && isFunction(value, 'Function')) return value;
  return fn.operatorDefinition?._lambdaLiteral;
}

/**
 * The body of the user function `fn` (a symbol for which
 * {@link isUserFunction} is true) with `args` in place of its parameters, or
 * `undefined` when no body is known.
 *
 * When the function has a literal ({@link userFunctionLiteral}), the
 * arguments replace the parameters in the body of the literal, and the body
 * is not evaluated. An evaluation would read the assigned value of a symbol
 * of the body: with `h := a ↦ a·x` and `x := 5`, the evaluated body of
 * `h(k)` is `5k`, and its derivative in `x` was 0. The derivative follows
 * the name `x` into the body of a called function whether or not `x` has a
 * value (user decision 2026-10-20), so `D(h(k), x)` is `k` in both cases.
 * The literal also lets a parameter used as a function name take a function
 * argument (`(f, a) ↦ f(a)` applied to `h` and `k` is `h(k)`; see
 * {@link partialFromFunctionLiteral}).
 *
 * A LAZY operator holds its operands: they are statements, conditions or
 * binders, not values. Its `evaluate` handler can run statements, throw on an
 * operand of an unexpected form, or loop until the deadline, so it is never
 * run. A lazy operator with no literal has no known body.
 *
 * Any other operator with no literal, or with a literal whose body cannot be
 * reduced to one expression (a block with control flow), is applied to
 * wildcards and the call is evaluated; the result is the body, unless it is
 * the same call again, and the arguments then replace the wildcards.
 */
function userFunctionBody(
  fn: Expression,
  args: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = fn.engine;
  const name = sym(fn)!;
  const literal = userFunctionLiteral(fn);
  if (literal !== undefined) {
    const body = partialFromFunctionLiteral(ce, literal, args);
    if (body !== undefined) return body;
  }
  if (fn.operatorDefinition?.lazy) return undefined;
  const wildcards =
    args.length === 1
      ? [ce.symbol('_')]
      : args.map((_, i) => ce.symbol(`_${i + 1}`));
  const body = ce.function(name, wildcards).evaluate();
  if (body.operator === name) return undefined;
  const map: Record<string, Expression> = {};
  wildcards.forEach((w, i) => {
    map[sym(w)!] = args[i];
  });
  return body.subs(map);
}

/**
 * Whether the definition of the user function `fn` calls `fn` again: the
 * body of its literal reaches the function (`reachesUserFunction()`), as in
 * `f(x) := x·f(x − 1)`, two functions that call each other, or
 * `F(x) := G(F, x)`. Such a function is not expanded in a derivative: its
 * derivative would hold `f(x − 1)` too, and the final evaluation of the
 * derivative at a symbolic `x` would never end (it stops at the recursion
 * limit with an error). The call keeps the chain rule, `f′(x)`, as it did
 * when the body was found by an evaluation, which gave the same call back.
 *
 * The test reads the definition, not the call: `h(h(x))` is not recursive,
 * and both calls are expanded. A function with no literal is not tested
 * here; its body is found by an evaluation (`userFunctionBody()`).
 */
function isRecursiveUserFunction(fn: Expression): boolean {
  const name = sym(fn);
  const literal = userFunctionLiteral(fn);
  if (name === undefined || literal === undefined || !isFunction(literal))
    return false;
  return reachesUserFunction(literal.op1, name);
}

/** Whether `expr` has a subexpression that is the same as `node`. */
function containsSame(expr: Expression, node: Expression): boolean {
  if (expr.isSame(node)) return true;
  return isFunction(expr) && expr.ops.some((x) => containsSame(x, node));
}

/**
 * The per-function cache behind {@link derivative}: for one function literal
 * and one differentiation variable, the chain of RAW iterates
 * (`iterates[k]` is `differentiate` applied `k` times, `iterates[0]` the body
 * the chain starts from) and the FINISHED result of each order (the iterate
 * with the closing `simplify()` of order >= 2 applied).
 *
 * Only a request made inside a constant fold of `simplify()` fills
 * `iterates` (sub-keys that end in `:raw`), with the state each step read
 * in `iterateReads`. Outside a fold, each
 * intermediate derivative is simplified before it is differentiated again,
 * so an iterate depends on the state of the engine like a finished result
 * does. Such iterates are not cached: a request starts from the finished
 * result of the highest valid lower order, and the dependencies of a
 * finished result include the symbols of every intermediate derivative that
 * was simplified to compute it.
 *
 * The two halves are guarded on DIFFERENT engine counters, because they read
 * different state:
 *
 * - `semanticVersion` is the engine's `_semanticVersion` at the time the
 *   entry was filled, and guards the raw iterates. Differentiating a body
 *   expands the definitions of the other user functions it calls, so a cached
 *   derivative is stale as soon as ANY definition changes; the whole entry is
 *   dropped when the version moves. A reassignment of the function itself is
 *   caught twice over — it bumps that version AND installs a fresh literal,
 *   which is the map's key.
 * - each finished result additionally carries the `generation` it was
 *   simplified under (`ce._cacheGeneration()`: the `any` invalidation axis
 *   plus the fact-suppression bit). The closing `simplify()` reads declared
 *   types and assumptions, and a declaration or a type write advances the
 *   `any` axis WITHOUT advancing the semantic one — writing `integer` onto a
 *   free symbol of the body turns `6x·sin(πb)` into `0`, and the entry filled
 *   before that write must not answer after it. Only the simplify is redone:
 *   the raw iterates are what the differentiation cost buys.
 *
 *   The `any` axis also advances on every call of a user function: the call
 *   declares the function's parameters in a new activation scope. So a
 *   generation match alone misses at every point of
 *   `Apply(Derivative(f, 3), x).N()` evaluated at many points, and each point
 *   did the closing `simplify()` again. A finished result therefore also
 *   records the definitions of the symbols the simplify read (`deps`, see
 *   {@link FinishedDerivative}). When the generation moved but the semantic
 *   version did not (that is checked by the entry), the fact-suppression bit
 *   is the same, and every recorded definition is still the one its symbol
 *   is bound to with the same `_writeVersion`, the result is still valid: a
 *   type write, an inference that narrows a symbol and a value write each
 *   bump the `_writeVersion` of the definition they change, and a
 *   redeclaration replaces the definition. The result is then stamped with
 *   the current generation.
 *
 *   There is one exception to "a value write bumps the `_writeVersion`": inside
 *   a call of a user function, a parameter of that function reads its value
 *   from the call frame's parameter ACTIVATION, a separate definition that
 *   each call declares and writes directly, with no `_writeVersion` bump. So
 *   a result is recorded without `deps` (valid only at its exact generation)
 *   when one of its symbols reads its value from a definition other than the
 *   one it is bound to, which is the case for such a parameter.
 */
type DerivativeChainCache = {
  semanticVersion: number;
  iterates: Map<string, (Expression | undefined)[]>;
  /** For each chain of `iterates`, the state that the differentiation step
   * which built `iterates[k]` read (`iterateReads[k]`; index 0 is empty). A
   * raw iterate can hold the result of a nested request (the evaluation of
   * a nested `Derivative`), whose value depends on that state. A request
   * that reuses `iterates[k]` adds the reads of steps 1 to k to its own. */
  iterateReads: Map<string, StateReads[]>;
  results: Map<string, Map<number, FinishedDerivative>>;
  /** The `generation` of the finished result that {@link derivative} last
   * returned from this entry, from the cache or newly recorded. It is
   * `undefined` until `derivative()` returns such a result.
   * `memoizedDerivativeResult` reads it. */
  lastFinishedGeneration?: number;
  /** The `any` invalidation axis at which that same finished result was
   * recorded or last validated. `memoizedDerivativeResult` orders results in
   * time by it: the axis only increases, where the composite generation
   * does not (inside a value shield it is a shield key, minted again — more
   * negative — at each advance of the axis; see
   * `IComputeEngine._cacheGeneration()`). */
  lastFinishedAny?: number;
  /** The `deps` of that same finished result. */
  lastFinishedDeps?: SymbolDependency[];
};

/**
 * One finished derivative (see {@link DerivativeChainCache}).
 *
 * `deps` holds, for each symbol node of the expression the closing
 * `simplify()` read, the definition the node is bound to and the
 * `_writeVersion` of that definition when the result was recorded. It is
 * `undefined` when the expression holds a node whose state cannot be
 * validated this way (an unbound symbol, whose meaning can change when the
 * name is declared later, or a node that is not a number, string, symbol or
 * function expression). Then only an exact generation match validates the
 * result.
 */
type FinishedDerivative = {
  generation: number;
  /** The `any` axis at `generation`: see `DerivativeChainCache.lastFinishedAny`. */
  any: number;
  value: Expression | undefined;
  deps?: SymbolDependency[];
};

/** A symbol node, the definition it is bound to (the inner value or operator
 * definition, which a redeclaration replaces) and the `_writeVersion` of that
 * definition (0 for an operator definition, which has none: a redefinition
 * of a function advances the semantic version instead). */
type SymbolDependency = [node: Expression, def: object, version: number];

/** The definition `node` is bound to now, or `undefined` when it is unbound. */
function boundDefinition(node: Expression): object | undefined {
  return node.valueDefinition ?? node.operatorDefinition;
}

/**
 * The symbol dependencies of `expr` (see {@link FinishedDerivative}), or
 * `undefined` when one of its nodes cannot be validated by its definition.
 */
function symbolDependencies(
  ...exprs: (Expression | undefined)[]
): SymbolDependency[] | undefined {
  const deps: SymbolDependency[] = [];
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (isNumber(e) || isString(e)) return true;
    if (isSymbol(e)) {
      if (seen.has(e)) return true;
      seen.add(e);
      const def = boundDefinition(e);
      if (def === undefined) return false;
      if (!readsOwnDefinition(e, e.symbol)) return false;
      deps.push([e, def, e.valueDefinition?._writeVersion ?? 0]);
      return true;
    }
    if (isFunction(e)) return e.ops.every(visit);
    return false;
  };
  for (const expr of exprs)
    if (expr !== undefined && !visit(expr)) return undefined;
  return deps;
}

/**
 * Does the symbol node `node` read its value from the definition it is bound
 * to (`node.valueDefinition`) in the current context? It does not inside a
 * call of a user function when the node is a parameter of that function: the
 * read goes to the call frame's parameter ACTIVATION, a separate definition
 * that each call declares anew and writes without bumping any
 * `_writeVersion` (see `valueDefinitionInContext` and `markActivation` in
 * `boxed-expression/binders.ts`). It also does not when the scope chain
 * holds another binding of the name that intercepts the read.
 */
function readsOwnDefinition(node: Expression, name: string): boolean {
  const own = node.valueDefinition;
  const read = valueDefinitionInContext(node.engine, name, own);
  return read === undefined || read === own;
}

/** Is every definition recorded in `deps` still the one its symbol is bound
 * to, unchanged since it was recorded? */
function symbolDependenciesValid(deps: SymbolDependency[]): boolean {
  for (const [node, def, version] of deps) {
    if (boundDefinition(node) !== def) return false;
    if ((node.valueDefinition?._writeVersion ?? 0) !== version) return false;
    // A result recorded where the node read its own definition is not served
    // where it reads another one, such as a parameter activation.
    if (isSymbol(node) && !readsOwnDefinition(node, node.symbol)) return false;
  }
  return true;
}

/**
 * Cached derivative chains, keyed by the FUNCTION LITERAL the derivative is
 * taken of. The literal is the right lifetime: assigning a new body to `f`
 * replaces the definition's `_lambdaLiteral` object, so the previous chain
 * becomes unreachable and is collected with it.
 *
 * The cache is what makes an n-th derivative cost one differentiation step
 * rather than n: `Derivative(f, 3)` continues the chain `Derivative(f, 2)`
 * left behind. It also serves the compile path, which asks for the same
 * closed form twice — once when the reference analysis probes whether the
 * `Derivative` head lowers (`BaseCompiler.analyzeReferences`), once when the
 * code is emitted.
 */
const derivativeChains = new WeakMap<Expression, DerivativeChainCache>();

/**
 * The cache key for differentiating `fn`: the function literal it resolves
 * to, or `undefined` when there is none to key on (a builtin operator symbol
 * such as `Sin`, whose derivative is a table lookup and costs nothing to
 * redo).
 */
function derivativeChainKey(fn: Expression): Expression | undefined {
  if (isFunction(fn, 'Function')) return fn;
  if (isSymbol(fn)) {
    // An operator whose definition has a `derivative` key is differentiated
    // through the key, not through its function literal (see
    // `derivative()`). A chain keyed on that literal would be the derivative
    // of the literal's body, so there is no key to cache on.
    if (fn.operatorDefinition?.derivative !== undefined) return undefined;
    const literal = fn.operatorDefinition?._lambdaLiteral;
    if (isFunction(literal, 'Function')) return literal;
  }
  return undefined;
}

/**
 * The finished result of order `order` for `subKey` in `cache`, or
 * `undefined` when there is none. A finished result is returned only when it
 * is valid in the engine state in force now: it was recorded at the current
 * generation, or its symbol dependencies are unchanged (see the comment of
 * `DerivativeChainCache`), in which case it is stamped with the current
 * generation. The `value` of the returned record can be `undefined`: that is
 * a cached decline.
 */
function finishedDerivative(
  ce: Expression['engine'],
  cache: DerivativeChainCache | undefined,
  subKey: string,
  order: number
): FinishedDerivative | undefined {
  const finished = cache?.results.get(subKey)?.get(order);
  if (finished === undefined) return undefined;
  // The dependencies are checked even when the generation matches: a write
  // to a definition that reports no state event still bumps its
  // `_writeVersion`.
  if (finished.deps !== undefined && !symbolDependenciesValid(finished.deps))
    return undefined;
  const generation = ce._cacheGeneration();
  if (finished.generation === generation) return finished;
  // The low bit of the generation is the fact-suppression bit: a result
  // simplified with the assumptions hidden is never served with them in
  // force, or the reverse.
  if (finished.deps === undefined) return undefined;
  if ((finished.generation & 1) !== (generation & 1)) return undefined;
  finished.generation = generation;
  finished.any = ce._anyVersion;
  return finished;
}

/**
 * The sub-key of a cache entry for `base` in one of the two modes of
 * {@link derivative}. Inside a constant fold of `simplify()`
 * (`isFoldingConstant()`) the intermediate derivatives are not simplified,
 * so a result has another form than outside a fold. The suffix `:raw` keeps
 * the results of the two modes apart, so that the form of a result does not
 * depend on the mode of an earlier request.
 */
function derivativeSubKey(base: string, foldMode: boolean): string {
  return foldMode ? `${base}:raw` : base;
}

/**
 * The symbol dependencies (see {@link FinishedDerivative}) that the
 * simplifications made during one request of {@link derivative} read.
 * `complete` is false when one of them cannot be validated: the result is
 * then recorded without `deps`, and is valid only at its exact generation.
 */
type StateReads = { deps: SymbolDependency[]; complete: boolean };

/**
 * The {@link StateReads} of the request of {@link derivative} that runs now,
 * or `undefined` outside a request. A request that starts inside another one
 * (the evaluation of a nested `Derivative`) adds the dependencies of its
 * result to the reads of the enclosing request: the enclosing result can be
 * built from the inner one.
 */
let activeStateReads: StateReads | undefined;

/** Add `deps` to the reads of the request that runs now, if any. */
function noteStateReads(deps: SymbolDependency[] | undefined): void {
  if (activeStateReads === undefined) return;
  if (deps === undefined) activeStateReads.complete = false;
  else activeStateReads.deps.push(...deps);
}

/**
 * Memoize the result of `compute`, the univariate arm of the `Derivative`
 * evaluate handler, per function literal, route and order.
 *
 * The {@link derivative} cache alone cannot serve that handler. The handler
 * wraps the closed form in a new `Function` literal, and canonicalizing that
 * literal declares its parameter, which advances the engine's cache
 * generation AFTER `derivative()` recorded its result. The next request then
 * sees a newer generation and does the closing `simplify()` again. This
 * memo records the generation after `compute` returns, so the lift is part
 * of the state the entry describes.
 *
 * The entry is recorded only when every write that advanced the generation
 * during `compute` is a write that `derivative()` itself accepts, or a write
 * of the lift. That is the case when, during `compute`, `derivative()`
 * returned a finished result of this entry at a generation equal to or
 * newer than the generation before `compute`: `derivative()` recorded that
 * result AFTER its own writes, and after it `compute` only lifts the
 * closed form into a function literal, which runs no user code. When
 * `derivative()` did not return such a result (it declined, or the order is
 * 0), or the semantic version moved during `compute`, a write of other code
 * (an impure function body, an inference that retypes a free symbol) can be
 * in the gap, and the entry is recorded only when the generation did not
 * move at all.
 *
 * The entry is read BEFORE `compute` runs, for the reason given on
 * `derivativeChainCache`. The sub-keys `result:apply` and `result:body`
 * cannot collide with the sub-keys of {@link derivative}, which start with
 * `apply:` or `body:`.
 */
export function memoizedDerivativeResult(
  fn: Expression,
  order: number,
  compute: () => Expression | undefined
): Expression | undefined {
  const cacheKey = derivativeChainKey(fn);
  if (cacheKey === undefined) return compute();
  const ce = fn.engine;
  const cache = derivativeChainCache(ce, cacheKey);
  const subKey = derivativeSubKey(
    isSymbol(fn) ? 'result:apply' : 'result:body',
    isFoldingConstant()
  );
  const finished = finishedDerivative(ce, cache, subKey, order);
  if (finished !== undefined) {
    noteStateReads(finished.deps);
    return finished.value;
  }
  const before = ce._cacheGeneration();
  const anyBefore = ce._anyVersion;
  cache.lastFinishedGeneration = undefined;
  cache.lastFinishedAny = undefined;
  cache.lastFinishedDeps = undefined;
  const value = compute();
  const after = ce._cacheGeneration();
  // See the comment of this function for the rule. `derivativeChains` holds
  // a new entry when the semantic version moved during `compute`. "Equal to
  // or newer" is decided on the `any` axis, which only increases; the
  // composite generation does not order results in time inside a value
  // shield (`lastFinishedAny`).
  const differentiated = cache.lastFinishedAny;
  const accounted =
    derivativeChains.get(cacheKey) === cache &&
    differentiated !== undefined &&
    differentiated >= anyBefore;
  if (!accounted && after !== before) return value;
  let byOrder = cache.results.get(subKey);
  if (byOrder === undefined) {
    byOrder = new Map();
    cache.results.set(subKey, byOrder);
  }
  // The lift reads the closed form only, so the dependencies of the closed
  // form are the dependencies of the lifted result. Without a closed form
  // (not `accounted`), there are none to validate by, and only an exact
  // generation match serves the entry.
  byOrder.set(order, {
    generation: after,
    any: ce._anyVersion,
    value,
    deps: accounted ? restampDisposed(cache.lastFinishedDeps) : undefined,
  });
  return value;
}

/**
 * The cached partial derivatives of the multi-index arm of the `Derivative`
 * evaluate handler (see {@link memoizedPartialDerivative}). The outer map is
 * keyed by the engine. The inner map is keyed by the function literal that is
 * differentiated or, for an operator with no such literal, by the operator
 * definition. A library operator definition can be shared by several
 * engines, and an entry holds expressions of one engine, so the engine is
 * part of the key.
 */
const partialDerivativeChains = new WeakMap<
  object,
  WeakMap<object, DerivativeChainCache>
>();

/** The entry of {@link partialDerivativeChains} for `key`, emptied when the
 * engine's semantic version moved (see {@link derivativeChainCache}). */
function partialDerivativeCache(
  ce: Expression['engine'],
  key: object
): DerivativeChainCache {
  let byKey = partialDerivativeChains.get(ce);
  if (byKey === undefined) {
    byKey = new WeakMap();
    partialDerivativeChains.set(ce, byKey);
  }
  const version = ce._semanticVersion;
  let entry = byKey.get(key);
  if (entry === undefined || entry.semanticVersion !== version) {
    entry = {
      semanticVersion: version,
      iterates: new Map(),
      iterateReads: new Map(),
      results: new Map(),
    };
    byKey.set(key, entry);
  }
  return entry;
}

/**
 * Memoize the result of `compute`, the multi-index arm of the `Derivative`
 * evaluate handler (`Derivative(f, k₁, …, kₙ)`), per function and order
 * vector. `source` is the function literal that `compute` differentiates, or
 * `undefined` when `fn` is an operator with no such literal (a library
 * operator such as `Arctan2`, or an operator with a `derivative` key).
 *
 * The univariate arm has the same memo ({@link memoizedDerivativeResult}).
 * Without it, an application `Apply(Derivative(f, 1, 0), x, y)` sampled at
 * many points computed the partial derivative again at each point: about
 * 0.5 s at each point for `Derivative(Arctan2, 3, 3)`.
 *
 * An entry is valid under the same rule as a finished result of
 * {@link derivative} (see `DerivativeChainCache`): the semantic version of
 * the engine is unchanged (a new definition of `f` or of a function that `f`
 * calls changes it, and a new definition of `f` also replaces the literal
 * that is the key), the fact-suppression bit is the same, and each free
 * symbol of `source` and of the result is bound to the same definition with
 * the same `_writeVersion`. The free symbols of `source` are recorded
 * because the evaluation of the partial derivative substitutes their values:
 * such a symbol does not occur in the result. When a free symbol reads its
 * value from a definition other than the one it is bound to (a captured
 * parameter inside a call of a user function), the entry is valid only at
 * the generation it was recorded at.
 *
 * The result of an impure function or operator is not memoized.
 */
export function memoizedPartialDerivative(
  fn: Expression,
  source: Expression | undefined,
  orders: ReadonlyArray<number>,
  compute: () => Expression | undefined
): Expression | undefined {
  const def = isSymbol(fn) ? fn.operatorDefinition : undefined;
  let key: object | undefined;
  if (isFunction(source, 'Function')) key = source.isPure ? source : undefined;
  else if (def !== undefined && def.pure) key = def;
  if (key === undefined) return compute();
  const ce = fn.engine;
  const cache = partialDerivativeCache(ce, key);
  const subKey = derivativeSubKey(
    `result:partial:${orders.join(',')}`,
    isFoldingConstant()
  );
  const finished = finishedDerivative(ce, cache, subKey, 0);
  if (finished !== undefined) {
    noteStateReads(finished.deps);
    return finished.value;
  }
  // `compute` calls `differentiate()`, which simplifies the inner derivative
  // of a nested `D` (`differentiateNode()`), and can reuse the results of
  // other requests. The symbols those read are part of the dependencies of
  // the result: with `b` an integer, the inner derivative `3u²·sin(πb)`
  // simplifies to 0, and the result holds no `b`.
  const reads: StateReads = { deps: [], complete: true };
  const outerReads = activeStateReads;
  activeStateReads = reads;
  let value: Expression | undefined;
  try {
    value = compute();
  } finally {
    activeStateReads = outerReads;
  }
  let deps = restampDisposed(
    symbolDependencies(...freeSymbolNodes(source), ...freeSymbolNodes(value))
  );
  if (deps !== undefined && reads.complete)
    deps = [...restampDisposed(reads.deps)!, ...deps];
  else deps = undefined;
  noteStateReads(deps);
  // A definition changed during `compute`: the entry no longer describes
  // the state of the engine.
  if (ce._semanticVersion !== cache.semanticVersion) return value;
  let byOrder = cache.results.get(subKey);
  if (byOrder === undefined) {
    byOrder = new Map();
    cache.results.set(subKey, byOrder);
  }
  byOrder.set(0, {
    generation: ce._cacheGeneration(),
    any: ce._anyVersion,
    value,
    deps,
  });
  return value;
}

/**
 * The symbol nodes of `expr` other than the parameters of `expr` when it is
 * a function literal. The parameters are bound by the literal: they are not
 * a state of the engine that a cached result depends on.
 */
function freeSymbolNodes(expr: Expression | undefined): Expression[] {
  if (expr === undefined) return [];
  let body = expr;
  const params = new Set<string>();
  if (isFunction(expr, 'Function')) {
    body = expr.op1;
    for (const p of expr.ops.slice(1)) {
      const name = functionLiteralParameterName(p);
      if (name) params.add(name);
    }
  }
  const nodes: Expression[] = [];
  const visit = (e: Expression) => {
    if (isSymbol(e)) {
      if (!params.has(e.symbol)) nodes.push(e);
    } else if (isFunction(e)) e.ops.forEach(visit);
  };
  visit(body);
  return nodes;
}

/**
 * `deps`, with the version of each disposed definition read again.
 *
 * The `Derivative` handler declares the hole `_` of `compute` in a scope that
 * it discards before `compute` returns. The discard disposes the definition
 * of the hole, and that advances its `_writeVersion` after `derivative()`
 * recorded it, so the entry would never validate again. A disposed
 * definition receives no more writes, so the version it has now is the
 * version to validate by.
 */
function restampDisposed(
  deps: SymbolDependency[] | undefined
): SymbolDependency[] | undefined {
  return deps?.map(([node, def, version]) =>
    (def as { disposed?: boolean }).disposed === true
      ? [node, def, (def as { _writeVersion?: number })._writeVersion ?? 0]
      : [node, def, version]
  );
}

/**
 * The cache entry for `key`, emptied when the engine's semantic state moved.
 * The version is read BEFORE the differentiation runs, so a declaration the
 * differentiation itself makes — an evaluation inside a throwaway compile
 * scope can devolve a bare builtin symbol into a variable — moves the version
 * past the entry and the next read starts over.
 */
function derivativeChainCache(
  ce: Expression['engine'],
  key: Expression
): DerivativeChainCache {
  const version = ce._semanticVersion;
  let entry = derivativeChains.get(key);
  if (entry === undefined || entry.semanticVersion !== version) {
    entry = {
      semanticVersion: version,
      iterates: new Map(),
      iterateReads: new Map(),
      results: new Map(),
    };
    derivativeChains.set(key, entry);
  }
  return entry;
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
  // Read the cache key from the ORIGINAL operand: the normalization below
  // rewrites a function symbol into an application of it, which is a fresh
  // expression on every call and so has no identity to key on.
  const cacheKey = derivativeChainKey(fn);
  let v = '_';
  // Whether the chain starts from an APPLICATION of the function to the hole
  // rather than from a body. See the sub-key below.
  let appliedForm = false;
  if (
    isSymbol(fn) &&
    (fn.operatorDefinition?.derivative !== undefined ||
      fn.operatorDefinition?.lazy)
  ) {
    // The `derivative` key of the definition has precedence over the body of
    // a function-literal `evaluate` handler. Differentiate the unevaluated
    // application `f(_)`: `differentiate()` then uses the key. Evaluating
    // `f(_)`, as the branch below does, would give the body of the literal.
    //
    // A LAZY operator is never evaluated on the hole either: its `evaluate`
    // handler can run statements, throw on an operand of an unexpected form,
    // or loop until the deadline (`Loop(_)`). `differentiate()` expands the
    // function literal of a lazy user operator without evaluating it, and
    // declines for any other lazy operator.
    //
    // A univariate derivative is defined only for an operator that takes one
    // argument. For an operator that needs more (`Arctan2`, or a user
    // operator with two parameters), the application `f(_)` is invalid: the
    // missing argument becomes an `Error` operand. Differentiating that
    // application gives an `Error("missing")` result (`Arctan2`), or throws
    // "Not canonical" (a user operator with an array `derivative` key).
    // There is no univariate derivative, so stay symbolic.
    fn = ce.function(fn.symbol, [ce.symbol('_')]);
    if (!fn.isValid) return undefined;
    appliedForm = true;
  } else if (isSymbol(fn) && fn.operatorDefinition) {
    // Look up a finished result BEFORE the normalization below. The
    // normalization evaluates `f(_)`, and that call declares the parameter of
    // `f` in a new activation scope. The declaration advances the engine's
    // cache generation, so a lookup made after it never matches the
    // generation that the previous call recorded, and each call does the
    // closing `simplify()` again. The sub-key of this route is `apply:_`,
    // which is the sub-key the lookup below computes, except when `f(_)`
    // evaluates to a function literal. Then this lookup finds nothing and
    // the lookup below applies.
    if (cacheKey !== undefined) {
      const earlyCache = derivativeChainCache(ce, cacheKey);
      const early = finishedDerivative(
        ce,
        earlyCache,
        derivativeSubKey('apply:_', isFoldingConstant()),
        order
      );
      if (early !== undefined) {
        earlyCache.lastFinishedGeneration = early.generation;
        earlyCache.lastFinishedAny = early.any;
        earlyCache.lastFinishedDeps = early.deps;
        noteStateReads(early.deps);
        return early.value;
      }
    }
    // We have, e.g. fn = 'Sin"
    fn = apply(ce.symbol(fn.symbol), [ce.symbol('_')]);
    appliedForm = true;
  } else if (isSymbol(fn)) {
    return ce._fn('Derivative', [fn, ce.number(order)]);
  }
  if (isFunction(fn, 'Function')) {
    // We have, e.g. fn = ['Function', ['Sin', 'x'], 'x']
    // A destructuring parameter (`((p, q)) => …`) names no single variable
    // to differentiate with respect to: decline rather than differentiate
    // with respect to a placeholder the body never mentions.
    if (fn.ops[1] !== undefined && isDestructuringParameter(fn.ops[1]))
      return undefined;
    v = functionLiteralParameterName(fn.ops[1]) || '_';
    fn = fn.ops[0];
  }
  const originalOrder = order;
  const cache =
    cacheKey === undefined ? undefined : derivativeChainCache(ce, cacheKey);
  // The variable is part of the sub-key: the same literal can be
  // differentiated with respect to its own parameter name (when the literal
  // itself is the operand) or with respect to the hole `_` (when a function
  // SYMBOL is, and the normalization above rewrote it to `f(_)`). The FORM
  // the chain starts from is part of it too, and the two are not redundant: a
  // literal whose parameter is spelled `_` differentiates its BODY with
  // respect to `_`, which is a different chain from the application `f(_)`
  // the symbol route builds, under the same variable name.
  // Inside a constant fold of `simplify()` (`isFoldingConstant()`) the
  // intermediate derivatives are not simplified (see the loop below), so the
  // results have another form. The `:raw` suffix keeps the two modes in
  // separate entries: the form of a result does not depend on the mode of an
  // earlier request.
  const foldMode = isFoldingConstant();
  const subKey = derivativeSubKey(
    appliedForm ? `apply:${v}` : `body:${v}`,
    foldMode
  );
  const finished = finishedDerivative(ce, cache, subKey, originalOrder);
  if (finished !== undefined) {
    cache!.lastFinishedGeneration = finished.generation;
    cache!.lastFinishedAny = finished.any;
    cache!.lastFinishedDeps = finished.deps;
    noteStateReads(finished.deps);
    return finished.value;
  }

  // The state that the simplifications of this request read: the
  // simplification of each intermediate derivative below, of the inner
  // derivative of a nested `D` (`differentiateNode()`), and the finished
  // results of other requests that this request uses. They are part of the
  // dependencies of the result.
  const reads: StateReads = { deps: [], complete: true };
  const outerReads = activeStateReads;
  activeStateReads = reads;
  let result: Expression | undefined;
  try {
    if (foldMode) {
      // The chain of raw iterates, extended in place: an order already
      // computed for this literal is the starting point, so `f'''` costs one
      // differentiation step once `f''` has been asked for. No iterate is
      // simplified here, but an iterate can hold the result of a nested
      // request, which depends on the state of the engine. So the state that
      // each step read is stored next to the iterate it built, and is added
      // to the reads of this request when the iterate is reused.
      const chain = cache?.iterates.get(subKey) ?? [fn];
      const chainReads: StateReads[] = cache?.iterateReads.get(subKey) ?? [
        { deps: [], complete: true },
      ];
      result = order < chain.length ? chain[order] : chain[chain.length - 1];
      let step = order < chain.length ? order : chain.length - 1;
      for (let k = 1; k <= step; k++) {
        const r = chainReads[k];
        noteStateReads(r === undefined || !r.complete ? undefined : r.deps);
      }
      while (step < order && result) {
        const stepReads: StateReads = { deps: [], complete: true };
        activeStateReads = stepReads;
        try {
          result = differentiate(result, v);
        } finally {
          activeStateReads = reads;
        }
        noteStateReads(stepReads.complete ? stepReads.deps : undefined);
        step += 1;
        chain[step] = result;
        chainReads[step] = stepReads;
      }
      cache?.iterates.set(subKey, chain);
      cache?.iterateReads.set(subKey, chainReads);
    } else {
      // Simplify each derivative of order 1 or more before it is
      // differentiated again. The chain rule and the product rule distribute
      // each level over the result of the previous one, so a derivative that
      // is not simplified grows quickly with the order. With this step the
      // third derivative of √(x+√(x+√(x+√(x+x)))) prints 37% shorter and
      // takes about a third of the time (measured 2026-10-25: 19,919 against
      // 31,386 characters, 2.2 s against 6.0 s).
      //
      // A simplified iterate depends on the state of the engine (declared
      // types, assumptions, whether the facts are hidden): with `b` an
      // integer, `3x²·sin(πb)` simplifies to 0. So the iterates are not
      // cached. The starting point is the finished result of the highest
      // lower order that is still valid (`finishedDerivative()` checks it).
      // A finished result of order 2 or more is the simplified iterate of
      // that order, so it is not simplified again. The symbols of each
      // iterate that is simplified are recorded in `reads`, so the result
      // is not served after a write to one of them, even when the
      // simplification removed the symbol.
      //
      // This `simplify()` cannot recurse without end: it runs on a
      // derivative of the body, which does not contain the `Derivative`
      // expression whose evaluation started this differentiation. When that
      // evaluation is a constant fold of `simplify()` (`f'''(2)` in
      // `1 + f'''(2)`), the other branch above runs and nothing is
      // simplified, so that route adds no call to `simplify()`. Other
      // evaluations inside `simplify()` (`elementWise()` in
      // `simplify-rules.ts`, the residue-class arithmetic in
      // `simplify.ts`) are not detected; on those routes, termination
      // rests on the same fact: the simplified iterate does not contain the
      // node whose evaluation started this differentiation.
      // ROADMAP CE-332 has the measurements.
      result = fn;
      let step = 0;
      let simplified = false;
      for (let k = order - 1; k >= 1; k--) {
        const lower = finishedDerivative(ce, cache, subKey, k);
        if (lower?.value === undefined) continue;
        result = lower.value;
        step = k;
        simplified = k >= 2;
        noteStateReads(lower.deps);
        break;
      }
      while (step < order && result) {
        let next = result;
        if (step >= 1 && !simplified) {
          next = result.simplify();
          noteStateReads(symbolDependencies(result, next));
        }
        simplified = false;
        result = differentiate(next, v);
        step += 1;
      }
    }
  } finally {
    activeStateReads = outerReads;
  }

  // The iterated product/quotient rule squares the denominator at each step,
  // so an r-th derivative can carry x^(2^r)-scale exponents (e.g. the 75th
  // derivative of sin(x)/x ends up over x^(2^75)). Left unreduced these
  // overflow on evaluation. A single simplify at the end cancels the common
  // factors back to a linear-degree denominator (x^(2^r) -> x^(r+1)); it is
  // cheap (~30ms even at order 75) precisely because it runs once, not per
  // step. The coefficients are already exact integers, so this only collapses
  // structure, it does not change values. Only needed for order >= 2 (a single
  // derivative cannot blow up), which also leaves the common case untouched.
  const raw = result;
  if (result && originalOrder >= 2) result = result.simplify();
  // The symbols the closing simplify read are those of the raw iterate; the
  // ones of the result are included in case the simplify introduced one.
  let deps = symbolDependencies(raw, result);
  if (deps !== undefined && reads.complete) deps = [...reads.deps, ...deps];
  else deps = undefined;
  noteStateReads(deps);
  if (cache !== undefined) {
    let byOrder = cache.results.get(subKey);
    if (byOrder === undefined) {
      byOrder = new Map();
      cache.results.set(subKey, byOrder);
    }
    // The generation is read AFTER the simplify: that is the state the result
    // describes, and the simplify itself can advance the axis (it pushes and
    // pops scopes).
    const generation = ce._cacheGeneration();
    const any = ce._anyVersion;
    byOrder.set(originalOrder, { generation, any, value: result, deps });
    cache.lastFinishedGeneration = generation;
    cache.lastFinishedAny = any;
    cache.lastFinishedDeps = deps;
  }
  return result;
}

/**
 * Read the multi-index of differentiation orders from a
 * `Derivative(f, n₁, …, n_k)` expression, padded with order 0 to `arity`
 * slots.
 *
 * Each order is the number of times `f` is differentiated with respect to the
 * argument in that position. A bare `Derivative(f)` is a first derivative in
 * the first argument, as `Derivative(f, 1)` is. Returns `undefined` if any order is not
 * a non-negative integer: a symbol, a negative or a fractional order is not
 * rounded down, so `D(f^{(1.5)}(x), x)` stays inert instead of `f''(x)`, as
 * the evaluate handler of `Derivative` keeps such an order inert.
 */
function derivativeOrders(
  derivativeFn: Expression,
  arity: number
): number[] | undefined {
  if (!isFunction(derivativeFn)) return undefined;
  const raw = derivativeFn.ops.slice(1);
  // More orders than arguments name no partial derivative. Truncated, the
  // extra orders were ignored: `D(Apply(Derivative(g, 1, 1), x), x)` gave
  // `Apply(Derivative(g, 2), x)`.
  if (raw.length > arity) return undefined;
  const orders: number[] = [];
  for (let i = 0; i < arity; i++) {
    if (i < raw.length) {
      const n = raw[i].N().re;
      if (!Number.isInteger(n) || n < 0) return undefined;
      orders.push(n);
    } else {
      // No explicit order for this slot: a bare `Derivative(f)` means a first
      // derivative in the first argument; any other missing slot is order 0.
      // The first slot was order 0 when there were several arguments, so
      // `Apply(Derivative(g), x, y)` was read as `g(x, y)` itself.
      orders.push(raw.length === 0 && i === 0 ? 1 : 0);
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
        if (!dependsOnVariable(args[i], v)) continue;
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
    // An argument that does not depend on `v` adds no term, as in the trace
    // above. Its derivative is not always the number 0: the derivative of
    // the list `[x ↦ x]` is a list, and the term it gave made
    // `D(Length([x ↦ x]), x)` a list, not 0.
    if (!dependsOnVariable(arg, v)) continue;
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
 * It also includes a SIZE limit (`MAX_DERIVATIVE_NODES`): an expression can
 * blow up in width without ever getting deep, and the result is the same
 * `undefined` decline rather than a result too large to be of any use.
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
  if (differentiationNesting === 0) {
    differentiationFootprint = 0;
    differentiationOverBudget = false;
  }
  differentiationNesting += 1;
  try {
    if (differentiationOverBudget) throw kOverBudget;
    const result = differentiateNode(expr, v, depth, trace);
    // Guard against runaway expression GROWTH. Checked on the way out of
    // EVERY level of the recursion, not just the top: a single top-level
    // `differentiate()` call is what assembles the runaway result, so a
    // check only at depth 0 would come too late. Two ways to exceed the
    // budget: the accumulated footprint (how much has been built so far —
    // the metric that stops the work early) and the size of this level's
    // result (which catches a result whose sharing keeps the footprint
    // small but which still prints as millions of characters).
    if (
      result !== undefined &&
      (boundedNodeCount(result, MAX_DERIVATIVE_NODES) > MAX_DERIVATIVE_NODES ||
        differentiationFootprint > MAX_DERIVATIVE_NODES)
    ) {
      differentiationOverBudget = true;
      throw kOverBudget;
    }
    return result;
  } catch (e) {
    if (e === kOverBudget && depth === 0) return undefined;
    throw e;
  } finally {
    differentiationNesting -= 1;
  }
}

/**
 * True when `base` is the symbol `ExponentialE` bound to the library
 * definition of Euler's number, so that ln(base) = 1. A user declaration can
 * give the name `ExponentialE` another value
 * (`ce.declare('ExponentialE', { value: 3 })`). Then ln(base) is not 1, and
 * the symbol is bound to a definition other than the one in the system
 * scope, where the standard library is installed.
 */
function isLibraryExponentialE(base: Expression): boolean {
  if (!isSymbol(base) || base.symbol !== 'ExponentialE') return false;
  const library =
    base.engine.contextStack[0]?.lexicalScope.bindings.get('ExponentialE');
  return (
    library !== undefined &&
    'value' in library &&
    library.value === base.valueDefinition
  );
}

/** The slot of a point that each point accessor reads. */
const POINT_ACCESSOR_SLOT: Record<string, number> = {
  PointX: 0,
  PointY: 1,
  PointZ: 2,
};

/**
 * The operators that select elements of an indexed collection by their
 * positions and do not compute with the values of the elements, with the
 * smallest and the largest number of operands of each. The first operand
 * is the collection; the other operands (a count, an index, a span) say
 * which positions are selected.
 *
 * When the selection operands do not change with the variable, the result
 * is a linear function of the collection: the same positions of the
 * derivative of the collection are the derivative of the result
 * (`d/du Last(h(u)) = Last(h′(u))`). The derivative of a collection has the
 * same length as the collection, so a selection out of range is out of
 * range in the derivative too, and gives the same absence or error.
 *
 * Not in this table: the operators whose selection depends on the values
 * of the elements (`Sort`, `Filter`, `Unique`, `Dedup`, `TakeWhile`,
 * `DropWhile`, `MaxBy`, `MinBy`, `Position`), and the operators that add
 * values to the collection or group its elements (`Insert`, `ReplaceAt`,
 * `Append`, `Join`, `Chunk`, `Partition`, `Cycle`, `Repeat`).
 */
const ELEMENT_SELECTOR_ARITY: Record<string, [number, number]> = {
  At: [2, Infinity],
  First: [1, 1],
  Second: [1, 1],
  Third: [1, 1],
  Last: [1, 1],
  Rest: [1, 1],
  Most: [1, 1],
  Reverse: [1, 1],
  Take: [2, 2],
  Drop: [2, 2],
  DeleteAt: [2, 2],
  RotateLeft: [1, 2],
  RotateRight: [1, 2],
  Slice: [2, 3],
};

/**
 * How the selection of `expr` changes with `v`:
 *
 * - `'linear'`: `expr` is a point accessor (`PointX`, `PointY`, `PointZ`
 *   with one operand) or an element selector (`ELEMENT_SELECTOR_ARITY`)
 *   whose selection operands are constant for a derivative with respect to
 *   `v` (`isConstantIndex()`). It is linear in its first operand.
 * - `'variable'`: `expr` is an element selector and a selection operand
 *   changes with `v` (`Take(L, u)`, `At(L, u)`). A count, an index or a
 *   span is an integer, so its value cannot change continuously, and the
 *   derivative has no closed form.
 * - `'keyed'`: `expr` is `At` of a dictionary or a record, or `At` with a
 *   string key (`At({"a": u, "b": u²}, "b")`). Its elements are not
 *   positions of an indexed collection: the derivative of a constant one
 *   is `At` of the zero of the value, and the others decline.
 * - `undefined`: `expr` is not a selector, or has a number of operands that
 *   the selector does not take.
 */
function selectorKind(
  expr: Expression & FunctionInterface,
  v: string,
  depth: number
): 'linear' | 'variable' | 'keyed' | undefined {
  if (POINT_ACCESSOR_SLOT[expr.operator] !== undefined)
    return expr.nops === 1 ? 'linear' : undefined;
  const arity = ELEMENT_SELECTOR_ARITY[expr.operator];
  if (arity === undefined) return undefined;
  if (expr.nops < arity[0] || expr.nops > arity[1]) return undefined;
  // Only `At` reads by a key. The other selectors read by position also
  // when the type of the container can be a dictionary
  // (`list<number> | dictionary<number>`): `accessorOfContainerDerivative()`
  // then requires a written-out list.
  if (
    expr.operator === 'At' &&
    (mayBeKeyedCollectionType(expr.op1.type.type) ||
      expr.ops.slice(1).some((op) => isString(op)))
  )
    return 'keyed';
  return expr.ops.slice(1).every((op) => isConstantIndex(op, v, depth))
    ? 'linear'
    : 'variable';
}

/** Whether a value of type `t` can be a dictionary or a record (`t`, or an
 * arm of `t` when it is a union, is one), a collection read by keys. */
function mayBeKeyedCollectionType(
  t: Type,
  seen: AliasDescent = undefined
): boolean {
  // A self-referential alias is unfolded once per path of the walk
  // (`unfoldAliasOnDescent()`): `type alias cyc = cyc | list<number>`
  // reaches itself through a union arm.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const r = unfolded.type;
  if (r === 'dictionary' || r === 'record') return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'dictionary' || r.kind === 'record') return true;
  if (r.kind === 'union')
    return r.types.some((arm) => mayBeKeyedCollectionType(arm, unfolded.seen));
  return false;
}

/** The containers whose operands are their elements, in order. */
const LITERAL_CONTAINERS = new Set(['Tuple', 'PointList', 'List']);

/** A `PointList` with a collection component: it zips its components into
 * a list of points (`PointList([a, 2a], 5)` is `[(a, 5), (2a, 5)]`), so its
 * operands are not its elements. */
function isZippedPointList(expr: Expression): boolean {
  return (
    isFunction(expr, 'PointList') &&
    expr.ops.some((op) => op.type.matches('collection'))
  );
}

/** `PointX`, `PointY`, `PointZ` or `At` over a zipped `PointList`. */
function isAccessorOfZippedPointList(
  expr: Expression
): expr is Expression & { op1: Expression; ops: Expression[] } {
  if (!isFunction(expr)) return false;
  const accessor =
    (POINT_ACCESSOR_SLOT[expr.operator] !== undefined && expr.nops === 1) ||
    (expr.operator === 'At' && expr.nops === 2);
  return accessor && isZippedPointList(expr.op1);
}

/**
 * The operand that an accessor of a literal container selects, or
 * `undefined` when `expr` is not such an accessor: `PointX`, `PointY` or
 * `PointZ` of a `Tuple` or a `PointList`, or `At` of a `Tuple`, a
 * `PointList` or a `List` with a literal integer index, 1-based, a negative
 * index counting from the end as `At` reads it. A slot the container does
 * not have (`PointZ` of a 2-point, an index out of range) is `undefined`
 * too. The accessor of a container that depends on the variable is then
 * the accessor of the derivative of the container (see
 * `accessorOfContainerDerivative()`), which reads the same absent slot and
 * gives the same absence or error as the accessor of the container.
 *
 * A `PointList` is a single point only when no component is a collection;
 * otherwise it zips its components into a list of points (`PointList([a,
 * 2a], 5)` is `[(a, 5), (2a, 5)]`), whose elements are not its operands,
 * and the `At` reads a point while a coordinate accessor reads a column of
 * the shortest zip. Such a `PointList` is left to the other rules.
 */
function selectedOperand(expr: Expression): Expression | undefined {
  if (!isFunction(expr)) return undefined;
  const container = expr.op1;
  if (!isFunction(container)) return undefined;
  if (isZippedPointList(container)) return undefined;
  const slot = POINT_ACCESSOR_SLOT[expr.operator];
  if (slot !== undefined && expr.nops === 1) {
    if (container.operator !== 'Tuple' && container.operator !== 'PointList')
      return undefined;
    return container.ops[slot];
  }
  if (expr.operator === 'At' && expr.nops === 2) {
    if (!LITERAL_CONTAINERS.has(container.operator)) return undefined;
    const index = expr.op2;
    if (!isNumber(index) || index.im !== 0 || !Number.isInteger(index.re))
      return undefined;
    const n = container.nops;
    const k = index.re > 0 ? index.re - 1 : index.re < 0 ? n + index.re : -1;
    return k >= 0 && k < n ? container.ops[k] : undefined;
  }
  return undefined;
}

/**
 * Whether the index `index` of an `At` is constant for a derivative with
 * respect to `v`: it does not depend on `v`, or it is pure and its
 * derivative is `0`. The second case is an index such as `⌈u⌉`, which jumps
 * at each integer and is constant between the jumps (`D(⌈u⌉) = 0`).
 */
function isConstantIndex(index: Expression, v: string, depth: number): boolean {
  if (!dependsOnVariable(index, v)) return true;
  if (!index.isPure) return false;
  return differentiate(index, v, depth + 1)?.isSame(0) === true;
}

/**
 * Whether the list of shape `dims` (the lengths, outermost first) whose
 * cells are `cell` has at most `MAX_DERIVATIVE_NODES` nodes. The count
 * starts at the innermost length, as `zeroList()` builds the list: each
 * level has one node for the list and its length times the nodes of one
 * element (`[2, 10000]` of numbers is 2 × (10000 + 1) + 1 = 20003 nodes).
 */
function zeroListFitsBudget(cell: Expression, dims: number[]): boolean {
  let nodes = isFunction(cell) ? cell.nops + 1 : 1;
  for (let i = dims.length - 1; i >= 0; i--) {
    nodes = nodes * dims[i] + 1;
    if (nodes > MAX_DERIVATIVE_NODES) return false;
  }
  return true;
}

/**
 * The list of shape `dims` (the lengths, outermost first) whose cells are
 * `cell`. The number of nodes is checked against the size limit of a
 * differentiation (`MAX_DERIVATIVE_NODES`) BEFORE the list is built: a
 * declared length can be very large (`vector<integer^100000000>`), and the
 * check of the result in `differentiate()` runs only after the result is
 * built. A list over the limit stops the differentiation, which declines,
 * as for any other result over the limit.
 */
function zeroList(cell: Expression, dims: number[]): Expression {
  if (!zeroListFitsBudget(cell, dims)) {
    differentiationOverBudget = true;
    throw kOverBudget;
  }
  const ce = cell.engine;
  let zero = cell;
  for (const n of [...dims].reverse()) {
    const element = zero;
    zero = ce.function(
      'List',
      Array.from({ length: n }, () => element)
    );
  }
  return zero;
}

/**
 * The zero of a value of type `t`: `0` for a number, the point
 * `(0, …, 0)` for a point of known arity whose coordinates can be numbers
 * (a tuple, or a union of tuples of the same arity), a list of zeros for a
 * list whose lengths are all known and whose cells have a zero
 * (`vector<integer^2>` gives `[0, 0]`, `list<tuple<integer, integer>^2>`
 * gives `[(0, 0), (0, 0)]`), `undefined` for any other type.
 */
function zeroOfType(
  ce: Expression['engine'],
  t: Type,
  seen: AliasDescent = undefined
): Expression | undefined {
  if (isSubtype(t, 'number')) return ce.Zero;
  // A self-referential alias is unfolded once per path of the walk
  // (`unfoldAliasOnDescent()`): `type alias cyc = cyc | list<number>`
  // reaches itself.
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return undefined;
  const r = unfolded.type;
  if (typeof r === 'string') return undefined;
  if (r.kind === 'list') {
    // A plain list (no `dimensions`) and a tensor of unknown rank (`null`)
    // have no known length. A length of `-1` is an open length.
    const dims = r.dimensions;
    if (!dims || dims.some((n) => !Number.isInteger(n) || n < 0))
      return undefined;
    const cell = zeroOfType(ce, r.elements, unfolded.seen);
    if (cell === undefined) return undefined;
    return zeroList(cell, dims);
  }
  const arms = r.kind === 'union' ? r.types.map(resolveTypeAlias) : [r];
  let arity: number | undefined;
  for (const arm of arms) {
    if (typeof arm === 'string' || arm.kind !== 'tuple') return undefined;
    const elements = arm.elements;
    if (elements === undefined) return undefined;
    // A coordinate typed `unknown` (a function whose parameter has no
    // inferred type yet) can hold a number.
    if (
      !elements.every(
        (x) => isSubtype(x.type, 'number') || isSubtype('number', x.type)
      )
    )
      return undefined;
    if (arity !== undefined && arity !== elements.length) return undefined;
    arity = elements.length;
  }
  if (arity === undefined) return undefined;
  return ce.function(
    'Tuple',
    Array.from({ length: arity }, () => ce.Zero)
  );
}

/**
 * `d`, the derivative of `op`, an element of a written-out collection or a
 * value arm of a piecewise expression. When `d` is the scalar `0` and the
 * type of `op` is a point or a list of known lengths, the result is the
 * zero of that type (`zeroOfType()`): the derivative of the constant point
 * `Q := (1, 2)` in `[(t, t²), Q]` is the point `(0, 0)`, so the derivative
 * of the list is `[(1, 2t), (0, 0)]` and not `[(1, 2t), 0]`, a list that
 * mixes a point and a number. A number keeps the scalar `0`. When the type
 * of `op` has no zero here (a list of unknown length, a type that is not
 * known), `d` stays the scalar `0`.
 *
 * When the type of `op` says that it can be absent (it has a `missing`
 * arm, as `missing | tuple<integer, integer>`), a zero built from the type
 * would turn an absent value into a present point. The zero is then built
 * from the VALUE of `op` when `op` does not depend on `v` and its value is
 * known (`zeroOfConstantContainerValue()`): `Missing` stays `Missing`, and
 * `(1, 2)` gives `(0, 0)`. Otherwise `d` stays the scalar `0`, and a
 * selector that reads the list declines (`withZeroPoints()`).
 */
function withZeroOfShape(op: Expression, d: Expression, v: string): Expression {
  if (!d.isSame(0)) return d;
  if (typeContainsMissing(op.type.type)) {
    if (dependsOnVariable(op, v)) return d;
    return zeroOfConstantContainerValue(op) ?? d;
  }
  return zeroOfType(d.engine, op.type.type) ?? d;
}

/**
 * Whether `expr` is a zero that `zeroOfConstantValue()` or `zeroOfType()`
 * builds: the scalar `0`, a tuple or a list whose elements are zeros, or
 * `Map(x ↦ z, xs)` where `z` is a zero. The derivative of a container
 * that is such a zero says that the container is constant.
 */
function isZeroValue(expr: Expression): boolean {
  if (expr.isSame(0)) return true;
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'List'))
    return expr.ops.every(isZeroValue);
  // The canonical form of a function literal holds its body in a `Block`.
  if (isFunction(expr, 'Block') && expr.nops === 1)
    return isZeroValue(expr.op1);
  if (isFunction(expr, 'Map') && expr.nops === 2) {
    const fn = expr.op1;
    return isFunction(fn, 'Function') && isZeroValue(fn.op1);
  }
  return false;
}

/**
 * The zero of the VALUE of `container`, an expression that does not depend
 * on the variable: each number is `0`, each absence marker (`Missing`,
 * `Undefined`, `NaN`) stays as it is, and the tuples, lists and
 * dictionaries keep their structure (`[(1, 2), Missing]` gives
 * `[(0, 0), Missing]`). A selector applied to this zero gives an absent
 * value where the selector applied to the container does.
 *
 * `undefined` when the value is not known (a symbol with no value, an
 * expression that is not pure), is not written out (a lazy collection), or
 * has more nodes than the size limit of a differentiation.
 */
function zeroOfConstantContainerValue(
  container: Expression
): Expression | undefined {
  if (!container.isPure) return undefined;
  const count = container.count;
  if (typeof count === 'number' && count > MAX_DERIVATIVE_NODES)
    return undefined;
  const ce = container.engine;
  let nodes = 0;
  const zero = (e: Expression): Expression | undefined => {
    nodes += 1;
    if (nodes > MAX_DERIVATIVE_NODES) return undefined;
    if (isAbsentSymbol(e)) return e;
    if (isNumber(e)) return e.isNaN ? e : ce.Zero;
    if (isFunction(e, 'Tuple') || isFunction(e, 'List')) {
      const ops: Expression[] = [];
      for (const op of e.ops) {
        const z = zero(op);
        if (z === undefined) return undefined;
        ops.push(z);
      }
      return ce.function(e.operator, ops);
    }
    if (isDictionary(e)) {
      const entries: Expression[] = [];
      for (const [key, value] of e.entries) {
        const z = zero(value);
        if (z === undefined) return undefined;
        entries.push(ce.function('KeyValuePair', [ce.string(key), z]));
      }
      return ce.function('Dictionary', entries);
    }
    return undefined;
  };
  return zero(container.evaluate());
}

/**
 * The derivative of `expr`, a value that is constant (or constant between
 * its jumps): the zero of its shape.
 *
 * - The type of `expr` gives the shape (`zeroOfType()`): `Last(P)` for a
 *   list of points `P` gives `(0, 0)`.
 * - A list whose type has no length and whose elements have a zero gives
 *   a list of zeros as long as `expr`: when `readCount` is true and the
 *   number of elements of `expr` is known and the list is within the size
 *   limit (`zeroListFitsBudget()`), the list itself (`[1, 2, 3]` gives
 *   `[0, 0, 0]`), otherwise `Map(x ↦ 0, expr)` (`Take(P, ⌈u⌉)` gives
 *   `Map(x ↦ (0, 0), Take(P, ⌈u⌉))`). The number of elements is read only
 *   for a value that does not depend on the variable.
 * - The scalar `0` when the shape is not known.
 *
 * `undefined` when the type of `expr` has a `missing` arm at any level: the
 * value, or one of its elements, can be absent, and a zero built from the
 * type would turn that absence into a present zero (`Last(P)` is
 * `Missing` when `P` is `[(1, 2), Missing]`). Use the value of a constant
 * then (`zeroOfConstantContainerValue()`).
 */
function zeroOfConstantValue(
  expr: Expression,
  readCount: boolean
): Expression | undefined {
  const ce = expr.engine;
  if (typeContainsMissing(expr.type.type)) return undefined;
  const type = stripMissingFromType(expr.type.type);
  const zero = zeroOfType(ce, type);
  if (zero !== undefined) return zero;
  if (!isSubtype(type, 'list')) return ce.Zero;
  const element = collectionElementType(type);
  const cell =
    element === undefined
      ? undefined
      : zeroOfType(ce, stripMissingFromType(element));
  if (cell === undefined) return ce.Zero;
  const count = readCount ? expr.count : undefined;
  if (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 0 &&
    zeroListFitsBudget(cell, [count])
  )
    return zeroList(cell, [count]);
  return ce.function('Map', [
    ce.function('Function', [cell, ce.symbol('x')]),
    expr,
  ]);
}

/**
 * `d`, the derivative of a value of type `t`, with each scalar `0` that
 * stands for a point replaced by the zero point (`zeroOfType()`), or
 * `undefined` when that cannot be decided.
 *
 * The elementwise rule and the piecewise rule give the zero of its shape
 * for a constant element or arm whose own type is a point
 * (`withZeroOfShape()`), and a derivative that is the scalar `0` as a
 * whole is read before this function (the selector rule of
 * `differentiateNode()`). One case remains, which this function repairs or
 * declines: an element or an arm whose own type did not give a shape (a
 * list of unknown length, a type that is not known) and that stayed the
 * scalar `0`, while the type of the container says that it is a point. An
 * accessor applied to a list that mixes points and scalars gives a wrong
 * value (`PointY([(1, 2t), 0])` is `[2t, Missing]`). The type of the ORIGINAL container says which elements
 * are points: a list of points is read element by element, a point is
 * kept, and the value arms of a piecewise derivative (`If`, `Which`) are
 * read with the same type. A derivative that is not a written-out list has
 * elements that cannot be read here, so it is accepted only when its
 * elements are numbers.
 */
function withZeroPoints(d: Expression, t: Type): Expression | undefined {
  const ce = d.engine;
  const type = stripMissingFromType(t);
  // A scalar `0` for a number is kept as it is. For a point or a list that
  // can be absent (`missing | tuple<…>`) it is not repaired: the zero point
  // would turn an absent value into a present one.
  if (d.isSame(0)) {
    if (isSubtype(type, 'number')) return d;
    return typeContainsMissing(t) ? undefined : zeroOfType(ce, type);
  }
  if (isFunction(d, 'If') || isFunction(d, 'Which')) {
    const isWhich = d.operator === 'Which';
    if (isWhich && d.nops % 2 !== 0) return undefined;
    const ops: Expression[] = [];
    for (const [i, op] of d.ops.entries()) {
      const isValueArm = isWhich ? i % 2 === 1 : i > 0;
      const arm = isValueArm ? withZeroPoints(op, t) : op;
      if (arm === undefined) return undefined;
      ops.push(arm);
    }
    return ce.function(d.operator, ops);
  }
  if (isSubtype(type, 'number') || isPointElementType(type)) return d;
  // A selection of a collection (`Take(xs′, 2)`, the derivative of
  // `Take(h(u), 2)`) gives elements of its collection. A selection that
  // this differentiator built has a collection that was repaired when the
  // selection was built (`accessorOfContainerDerivative()`), and any other
  // selection reads elements of a value, not zeros that stand for points.
  if (isFunction(d) && ELEMENT_SELECTOR_ARITY[d.operator] !== undefined)
    return d;
  // A list of zeros as long as a value (`Map(x ↦ (0, 0), Take(P, ⌈u⌉))`,
  // built by `zeroOfConstantValue()` from the type of its elements).
  if (isFunction(d, 'Map') && isZeroValue(d)) return d;
  // The elements are read with the type of the container WITHOUT its own
  // `missing` arm only: `stripMissingFromType()` also removes the `missing`
  // arm of the elements, which says that an element can be absent.
  const element =
    collectionElementType(withoutAbsentArm(t)) ?? collectionElementType(type);
  if (element === undefined) return undefined;
  if (isFunction(d, 'List')) {
    const ops: Expression[] = [];
    for (const op of d.ops) {
      const repaired = withZeroPoints(op, element);
      if (repaired === undefined) return undefined;
      ops.push(repaired);
    }
    return ce.function('List', ops);
  }
  return isSubtype(stripMissingFromType(element), 'number') ? d : undefined;
}

/** The type `t` without its top-level `missing` arm (`missing | list<T>`
 * gives `list<T>`). The arms of the parts of `t` are kept. */
function withoutAbsentArm(t: Type): Type {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return r;
  const arms = r.types.filter((arm) => arm !== 'missing');
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
}

/**
 * The derivative of the accessor `expr` (`PointX`, `PointY`, `PointZ`, or
 * an element selector with constant selection operands, see
 * `selectorKind()`) from the derivative `dContainer` of its
 * container: the accessor of `dContainer`, after the scalar zeros that
 * stand for points are replaced by zero points (`withZeroPoints()`, which
 * reads the type of the ORIGINAL container: the derivative does not say
 * whether a list of two numbers is one point or two coordinates).
 * `undefined` when the reading cannot be decided or the result is not
 * valid.
 *
 * With `isExactZero`, `dContainer` is a zero built from the value or from
 * the type of the container (`zeroOfConstantContainerValue()`,
 * `zeroOfConstantValue()`). Each of its elements has the shape of the
 * element it stands for, so it is used as it is.
 *
 * A `PointList` derivative is used as it is: it is the `PointList` of the
 * derivatives of the components (the elementwise rule), which zips as the
 * differentiated `PointList` does. A scalar `0` component is repeated by
 * the zip, which is correct only for a component that is a number: the
 * elementwise rule gives a constant collection component a list of zeros
 * of the same length. When the container is a written-out `PointList`, a
 * scalar `0` component whose original component is not a number is
 * checked here too, and the derivative declines.
 */
function accessorOfContainerDerivative(
  expr: Expression & FunctionInterface,
  dContainer: Expression,
  isExactZero = false
): Expression | undefined {
  // A container whose type can be a dictionary or a record
  // (`list<number> | dictionary<number>`) is read by position only when the
  // zero or the derivative is a written-out list or tuple.
  if (
    mayBeKeyedCollectionType(expr.op1.type.type) &&
    !isFunction(dContainer, 'List') &&
    !isFunction(dContainer, 'Tuple')
  )
    return undefined;
  let repaired: Expression | undefined;
  if (isExactZero) repaired = dContainer;
  else if (isFunction(dContainer, 'PointList')) {
    const container = expr.op1;
    if (
      isFunction(container, 'PointList') &&
      (container.nops !== dContainer.nops ||
        dContainer.ops.some(
          (d, i) =>
            d.isSame(0) && !isSubtype(container.ops[i].type.type, 'number')
        ))
    )
      return undefined;
    repaired = dContainer;
  } else repaired = withZeroPoints(dContainer, expr.op1.type.type);
  if (repaired === undefined) return undefined;
  const accessed = expr.engine.function(expr.operator, [
    repaired,
    ...expr.ops.slice(1),
  ]);
  return accessed.isValid ? accessed : undefined;
}

/** The differentiation rules themselves. Always reached through
 * `differentiate()`, which applies the depth and size guards. */
function differentiateNode(
  expr: Expression,
  v: string,
  depth: number,
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

  // Differentiation can blow up in WIDTH, not just depth: the product and
  // chain rules square the expression size at each order, so an r-th
  // symbolic derivative (of LambertW, for example) can allocate gigabytes
  // building one expression while staying well under
  // MAX_DIFFERENTIATION_DEPTH. So check the engine deadline every 256 calls.
  checkDeadlineEvery(expr.engine._deadlineFrame, 0xff);

  const ce = expr.engine;

  // A few easy ones...
  if (isString(expr)) return undefined;
  if (isNumber(expr)) return expr.engine.Zero;
  if (isSymbol(expr)) {
    if (expr.symbol === v) return expr.engine.One;

    // Resolve user-defined functions: e.g. f where f(x) := 2x
    if (isUserFunction(expr) && !isRecursiveUserFunction(expr)) {
      const ce = expr.engine;
      const bodyWithV = userFunctionBody(expr, [ce.symbol(v)]);
      // If the body resolved (is not just the same function call), differentiate it
      if (bodyWithV !== undefined) {
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

  // The variable is the function of this application (`f(x)` with respect
  // to `f`). There is no closed form for a derivative with respect to a
  // function. `expr.has(v)` does not see the operator name, so without this
  // test the rules below took `f(x)` as a constant and returned 0: `D(f(x),
  // f)` was 0, and `Derivative(Apply, 1, 0)` was `(x_1, x_2) ↦ 0`.
  if (expr.operator === v) return undefined;

  // The rules below select an operator by its NAME. A user definition that
  // shadows a library operator (`Sinh(x) := 3x`), or a caller library that
  // defines a standard name, has another meaning: differentiate it as a user
  // function, as `evaluate()` does, never with the library operator's rule.
  if (shadowsLibraryName(ce, expr.operator))
    return differentiateUnknownApplication(expr, v, depth, trace);

  if (expr.operator === 'Negate') {
    recordD(trace, expr, v, 'derivative.constant-multiple', () =>
      dPlaceholder(expr.op1, v).neg()
    );
    const gPrime = differentiate(expr.op1, v, depth + 1, trace);
    if (gPrime) return gPrime.neg();
    return ce._fn('D', [expr.op1, ce.symbol(v)]).neg();
  }

  // Block - differentiate its value. A block of one statement has the value
  // of that statement. A block of several statements has the value of the
  // last one, but the statements before it can assign the local variables it
  // reads (`Block(a := 2, a·x)`), so the last statement alone is not its
  // value: `blockValue()` substitutes the assigned values first, and the
  // derivative stays unevaluated when the block is not a plain sequence of
  // local declarations and assignments.
  if (expr.operator === 'Block') {
    const value = blockValue(ce, expr, v);
    if (value === undefined) return undefined;
    recordD(trace, expr, v, 'derivative.rewrite', () => dPlaceholder(value, v));
    return differentiate(value, v, depth + 1, trace);
  }

  // List/Tuple (vector/matrix/point literal): these are containers, not
  // functions of their elements, so they have no chain-rule semantics.
  // Differentiate elementwise, preserving both shape and the container head
  // (recursively for nested containers — matrices are lists of lists). Only
  // literal operands broadcast this way; a symbol declared as a matrix/vector
  // has no visible elements and never reaches this branch.
  //
  // `Tuple` is the parse of a parenthesized vector `(f(t), g(t))`, so this is
  // the branch that gives a tuple-valued space curve the standard
  // vector-calculus rule d/dt (fₓ, f_y, f_z) = (fₓ', f_y', f_z'). Without it a
  // `Tuple` fell through to the generic chain rule below and differentiated the
  // `Tuple` OPERATOR, leaving inert `Apply(Derivative("Tuple", …), …)` nodes
  // (reported by the Tycho team as item 174; a Frenet-frame document built on
  // `f'(t)/|f'(t)|` never closed and drew nothing).
  //
  // `PointList` belongs here too: it is the explicit point-container head that
  // importers emit, and evaluating it yields a `Tuple` (scalar components) or a
  // `List` of tuples (one or more collection components, which it zips). Either
  // way d/dt acts componentwise on the operands, and zipping commutes with it,
  // so differentiating the operands and keeping the `PointList` head gives the
  // same answer as differentiating the evaluated form. Keeping the head matters
  // because `PointList` is load-bearing downstream (plot lowering). Without
  // this case a `PointList` body reached the generic chain rule and produced
  // inert `Apply(Derivative("PointList", …), …)` nodes — the same failure as
  // item 174, resurfacing for `PointList` as Tycho item 192(a). It only bit the
  // route that differentiates an UNEVALUATED body: a function literal stored as
  // a symbol's VALUE (`p` assigned `Function(PointList(…), t)`, reached via
  // `Derivative(p, 1)`), whereas an operator definition (`g(t) := …`) is
  // resolved by applying and EVALUATING it, which had already turned the
  // `PointList` into a `Tuple`.
  //
  // An element that does not depend on `v` has the derivative `0`. When the
  // element is a point or a list of known lengths, that derivative is the
  // zero of its shape (`withZeroOfShape()`): with `Q := (1, 2)`, the
  // derivative of `[(t, t²), Q]` is `[(1, 2t), (0, 0)]`. It was
  // `[(1, 2t), 0]`, a list that mixes a point and a number.
  //
  // A component of a `PointList` that is a constant collection must stay a
  // collection of the same length: the zip repeats a scalar component for
  // every point, but a collection component sets the number of points (the
  // zip stops at the shortest component). When its type gives no zero (a
  // list of unknown length), the zero is a list of zeros as long as the
  // component (`zeroOfConstantValue()`). With `c := [5, 6]`, the
  // derivative of `PointList(u, c)` is `PointList(1, [0, 0])`, the points
  // `[(1, 0), (1, 0)]`; the scalar `0` gave the single point `(1, 0)`. A
  // component whose zero cannot be built stays the scalar `0`, and a
  // selector of the `PointList` declines (`accessorOfContainerDerivative()`).
  if (
    expr.operator === 'List' ||
    expr.operator === 'Tuple' ||
    expr.operator === 'PointList'
  ) {
    const isPointList = expr.operator === 'PointList';
    const elements = expr.ops.map((op) => {
      const d = withZeroOfShape(
        op,
        differentiate(op, v, depth + 1, trace) ??
          ce._fn('D', [op, ce.symbol(v)]),
        v
      );
      if (isPointList && d.isSame(0) && op.type.matches('collection'))
        return (
          (dependsOnVariable(op, v)
            ? undefined
            : zeroOfConstantContainerValue(op)) ??
          zeroOfConstantValue(op, false) ??
          d
        );
      return d;
    });
    if (elements.some((e) => !e.isValid)) return undefined;
    return ce.function(expr.operator, elements);
  }

  // An accessor of a literal container selects one of its operands, so its
  // derivative is that operand's: `PointX`, `PointY`, `PointZ` of a `Tuple`
  // or a `PointList`, and `At` of a `Tuple`, a `PointList` or a `List` with
  // a literal integer index. Without this rule the accessor fell through to
  // the generic chain rule below, which read it as an unknown function of
  // the whole container and gave `PointList(2, 0) · Apply(Derivative("PointX",
  // 1), …)`, a product of a point and a number that is a type error; the
  // Jacobian of `FindRoot` over `PointX(PointList(2a, 2)) = 4` was then NaN
  // and the solver stopped at its start (Tycho row 415).
  {
    const selected = selectedOperand(expr);
    if (selected !== undefined) {
      recordD(trace, expr, v, 'derivative.rewrite', () =>
        dPlaceholder(selected, v)
      );
      return differentiate(selected, v, depth + 1, trace);
    }
  }

  // The same accessors over a `PointList` that zips (a component is a
  // collection): the zip and the projection are linear in the components
  // and commute with differentiation, so the derivative is the accessor of
  // the differentiated `PointList` (the elementwise rule above):
  // `d/da At(PointList([a, 2a], 5), 1)` is `At(PointList([1, 2], 0), 1)`,
  // the point `(1, 0)`, and `PointY(PointList([1, 2, 3], 2a))` gives
  // `[2, 2, 2]`, truncated to the shortest component as the zip is.
  if (isAccessorOfZippedPointList(expr)) {
    const dContainer = differentiate(expr.op1, v, depth + 1, trace);
    if (dContainer === undefined || !dContainer.isValid) return undefined;
    return ce.function(expr.operator, [dContainer, ...expr.ops.slice(1)]);
  }

  // The same accessors over a container that is not written out: a call of
  // a function that gives a point or a list of points (`PointY(h(u))`), or
  // any other expression. An accessor reads one coordinate of each point,
  // and `At` with an index that does not depend on `v` reads one element.
  // Both are linear, so the derivative is the accessor of the derivative of
  // the container: with `g := t ↦ (t, t²)`, `d/du PointY(g(u))` is
  // `PointY((1, 2u))`, which is `2u`. Without this rule the accessor fell
  // through to the generic chain rule below, which read it as an unknown
  // scalar function of the container. It gave the wrong tuple
  // `(PointY′(g(u)), 2u·PointY′(g(u)))`, and for a container that is a long
  // list of points it built a product of the list with the unknown partial
  // derivative, larger than the size limit, and declined after about 0.5 s
  // (Tycho ledger row 424).
  //
  // An index that depends on `v` but whose derivative is `0` (`⌈u⌉`, an
  // integer that jumps at each integer and is constant between the jumps)
  // is a constant index between its jumps, the convention of `D(⌈u⌉) = 0`:
  // `d/du At(L(u), ⌈u⌉)` is `At(L′(u), ⌈u⌉)`.
  //
  // The other operators that select elements by position (`First`, `Last`,
  // `Take`, `Drop`, `Rest`, `Most`, `Slice`, `Reverse`, …; see
  // `ELEMENT_SELECTOR_ARITY`) are linear for the same reason when their
  // count, index or span is constant: `d/du Last(h(u))` is `Last(h′(u))`.
  // They also fell through to the generic chain rule, which gave a product
  // of the derivative of the container with an unknown partial derivative
  // (`[Last′(L(u)), 2u·Last′(L(u)), …]`), and declined after about 1.1 s for
  // the long list of points of Tycho ledger row 424.
  //
  // A selector whose count, index or span changes with `v` (`Take(L(u), u)`,
  // `At(P, u)`) has no closed form, and the derivative declines. The generic
  // chain rule gave unknown partial derivatives of the selector with
  // respect to the selection operand (`Apply(Derivative("At", 0, 1), P, u)`).
  //
  // A selector with a constant selection of a container that does not
  // depend on `v` is a constant, and its derivative is the zero of its shape
  // (`zeroOfConstantValue()`): `D(Take([1, 2, 3], 2), u)` is `[0, 0]`,
  // and `D(Last(P), u)` is `(0, 0)` for a list of points `P`. The generic
  // chain rule multiplied an unknown partial derivative by the derivative
  // of the container, and gave a list as long as the container:
  // `D(First([1, 2]), u)` was `[0, 0]`.
  //
  // The zero is the selector applied to the zero of the CONTAINER, so that
  // a selection out of range stays out of range: `D(Third([1, 2]), u)` is
  // `Third([0, 0])`, which is `NaN` as `Third([1, 2])` is. Only when the
  // shape of a constant container is not known is the zero read from the
  // type of the selection.
  //
  // A container whose derivative is the scalar `0` (a selection that is
  // constant between its jumps, `Take(P, ⌈u⌉)`) is read the same way: its
  // zero is built from its own type and value (`zeroOfConstantValue()`,
  // `Map(x ↦ (0, 0), Take(P, ⌈u⌉))`), and the selector is applied to it.
  // `D(At([⌈u⌉], 2), u)` is `At([0], 2)`, out of range as `At([⌈u⌉], 2)`
  // is. Read through the zero repair (`withZeroPoints()`), the scalar `0` of
  // a list of unknown length had no zero, and an outer selector declined
  // (`D(PointY(Take(P, ⌈u⌉)), u)`).
  //
  // `At` of a dictionary or a record by a key that depends on `v` declines:
  // the generic chain rule gave unknown partial derivatives of `At` (with a
  // record, an `Error`). A constant one is `At` of the zero of the value of
  // the dictionary (`zeroOfConstantContainerValue()`): a key that is absent
  // stays absent.
  //
  // A constant container is read by its VALUE when it is known
  // (`zeroOfConstantContainerValue()`), so that an absent element stays
  // absent: with `P := [(1, 2), Missing]`, `D(Last(P), u)` is
  // `Last([(0, 0), Missing])`, which is `Missing`. When the value is not
  // known, the zero is built from the type, and the derivative declines if
  // the type says that a value can be absent.
  const selection = selectorKind(expr, v, depth);
  if (selection === 'variable') return undefined;
  if (selection === 'keyed') {
    if (dependsOnVariable(expr, v)) return undefined;
    const zero = zeroOfConstantContainerValue(expr.op1);
    if (zero === undefined) return undefined;
    return ce.function('At', [zero, ...expr.ops.slice(1)]);
  }
  if (selection === 'linear' && !dependsOnVariable(expr.op1, v)) {
    const zero =
      zeroOfConstantContainerValue(expr.op1) ??
      zeroOfConstantValue(expr.op1, true);
    if (zero === undefined) return undefined;
    if (zero.isSame(0))
      return zeroOfConstantValue(expr, !dependsOnVariable(expr, v));
    return accessorOfContainerDerivative(expr, zero, true);
  }
  if (selection === 'linear') {
    recordD(trace, expr, v, 'derivative.rewrite', () =>
      ce.function(expr.operator, [
        dPlaceholder(expr.op1, v),
        ...expr.ops.slice(1),
      ])
    );
    const dContainer = differentiate(expr.op1, v, depth + 1, trace);
    if (dContainer === undefined || !dContainer.isValid) return undefined;
    if (dContainer.isSame(0)) {
      const zero = zeroOfConstantValue(expr.op1, false);
      if (zero === undefined) return undefined;
      return accessorOfContainerDerivative(expr, zero, true);
    }
    return accessorOfContainerDerivative(expr, dContainer);
  }

  // Piecewise definitions (`Which`, and its two-branch form `If`): each value
  // arm holds on its own region, so the derivative is the piecewise function
  // of the arms' derivatives, with the conditions carried over unchanged:
  //
  //     d/dv Which(c₁, u₁, …, cₙ, uₙ) = Which(c₁, u₁′, …, cₙ, uₙ′)
  //     d/dv If(c, a, b)              = If(c, a′, b′)
  //
  // The jump at a region boundary is NOT represented — a piecewise function
  // that is discontinuous there has no derivative at that point, and the
  // answer above is the derivative on the interior of every region. That is
  // the convention every CAS uses for a piecewise derivative.
  //
  // Without this arm the lazy-operator decline further down left `D` inert,
  // which reached ordinary user input through the distributions: a CDF or PDF
  // evaluates to a closed form written as a `Which`
  // (`CDF(ExponentialDistribution(2), x)` is
  // `Which(x < 0, 0, True, 1 - e^(-2x))`), so differentiating an evaluated CDF
  // answered nothing instead of the density.
  //
  // The conditions are held operands and are never differentiated: they are
  // boolean, not values. The arms may still be UNBOUND on the box and parse
  // routes, because a lazy operator holds its operands, so canonicalize each
  // arm before differentiating it (`.canonical` binds structure without
  // substituting assigned symbol values).
  //
  // An arm that does not depend on `v` and is a point (or a list of known
  // lengths) has the zero of its shape as its derivative, as an element of
  // a written-out list has (`withZeroOfShape()`): the derivative of
  // `If(0 < u, (u, 1), Q)` is `If(0 < u, (1, 0), (0, 0))`, not
  // `If(0 < u, (1, 0), 0)`.
  if (expr.operator === 'Which' || expr.operator === 'If') {
    // `Which` operands are strictly paired `(condition, value)`; an odd count
    // is a malformed call that the `Which` canonical handler reports as an
    // error, so decline rather than guess how to pair them.
    const isWhich = expr.operator === 'Which';
    if (isWhich && expr.nops % 2 !== 0) return undefined;
    // A value arm sits at every odd position of a `Which`, and at every
    // position but the first (the condition) of an `If`.
    const isValueArm = (i: number) => (isWhich ? i % 2 === 1 : i > 0);
    const ops = expr.ops.map((op, i) => {
      if (!isValueArm(i)) return op;
      const arm = op.canonical;
      return withZeroOfShape(
        arm,
        differentiate(arm, v, depth + 1, trace) ??
          ce._fn('D', [arm, ce.symbol(v)]),
        v
      );
    });
    if (ops.some((e) => !e.isValid)) return undefined;
    recordD(trace, expr, v, 'derivative.piecewise-rule', () =>
      ce.function(
        expr.operator,
        expr.ops.map((op, i) =>
          isValueArm(i) ? dPlaceholder(op.canonical, v) : op
        )
      )
    );
    return ce.function(expr.operator, ops);
  }

  // Big operators: a `Sum` is differentiated term by term, a `Product` with a
  // small finite range is expanded first. See `differentiateBigOp()`.
  if (expr.operator === 'Sum' || expr.operator === 'Product')
    return differentiateBigOp(expr, v, depth, trace);

  // D - evaluate the derivative first, then differentiate the result
  if (expr.operator === 'D') {
    const evaluated = expr.evaluate();
    // Avoid infinite recursion if D doesn't simplify
    if (evaluated.operator === 'D') return undefined;
    recordD(trace, expr, v, 'derivative.rewrite', () =>
      dPlaceholder(evaluated, v)
    );
    // Simplify the inner derivative before it is differentiated again. The
    // chain rule distributes the outer derivative over every term of the
    // inner one, so an inner derivative that is not simplified makes the
    // result grow quickly with the number of nested `D`.
    //
    // This `simplify()` cannot recurse without end: it runs on the evaluated
    // inner derivative, which has no `D` at its root (the test above returns
    // first) and does not contain the `D` node whose evaluation started this
    // differentiation. Inside a constant fold of `simplify()`
    // (`isFoldingConstant()`) the step is skipped, so that route adds no
    // call to `simplify()`. Other evaluations inside `simplify()`
    // (`elementWise()` in `simplify-rules.ts`, the residue-class arithmetic
    // in `simplify.ts`) are not detected; on those routes, termination rests
    // on the same fact.
    //
    // The simplified form depends on the state of the engine (with `b` an
    // integer, `3x²·sin(πb)` simplifies to 0), so the symbols it read are
    // added to the dependencies of the request of `derivative()` that runs
    // now, if any (`noteStateReads()`).
    if (isFoldingConstant())
      return differentiate(evaluated, v, depth + 1, trace);
    const simplified = evaluated.simplify();
    noteStateReads(symbolDependencies(evaluated, simplified));
    return differentiate(simplified, v, depth + 1, trace);
  }

  // EvaluateAt - the value of a function at a point: evaluate it first, then
  // differentiate the value. `subs()` of the variable of a `D`, a `Series` or
  // an indefinite `Integrate` gives such a form (`D(x^3, x)` with `x`
  // replaced by `y` is `EvaluateAt(Function(D(x^3, x), x), y)`, whose value
  // is `3y^2`), so without this rule the derivative of a substituted
  // expression stayed unevaluated. A value that is still an `EvaluateAt`
  // has no closed form, and the derivative stays unevaluated too.
  if (expr.operator === 'EvaluateAt') {
    const evaluated = expr.evaluate();
    if (evaluated.operator === 'EvaluateAt') return undefined;
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

  // The application of a function literal, `Apply(t ↦ t·x, k)`, is the body
  // of the literal with the arguments in place of its parameters, `k·x`.
  // Without this rule, the chain rule below took `Apply` for an unknown
  // function of the literal and of the arguments, and gave a result with the
  // parameter `t` free in it.
  if (expr.operator === 'Apply' && isFunction(expr.op1, 'Function')) {
    const body = partialFromFunctionLiteral(ce, expr.op1, expr.ops.slice(1));
    // A literal applied to itself (`Apply(L, L, x)` with
    // `L := (p, a) ↦ p(p, a)`) gives the same application back.
    if (body === undefined || containsSame(body, expr)) return undefined;
    recordD(trace, expr, v, 'derivative.expand-definition', () =>
      dPlaceholder(body, v)
    );
    return differentiate(body, v, depth + 1, trace);
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
      if (!dependsOnVariable(op, v)) return ce.Zero;
      return ce._fn('D', [op, ce.symbol(v)]);
    });
    if (terms.some((term) => !term.isValid)) return undefined;
    return simplifyDerivative(add(...terms));
  }

  // Product rule
  if (expr.operator === 'Multiply') {
    // The product of two matrices does not commute, so the derivative of
    // each factor replaces that factor IN PLACE: (f·g)' is f'·g + f·g', not
    // f'·g + g'·f. A product with no factor that may be a matrix keeps the
    // derivative first, as before.
    const ordered = expr.ops.some(mayBeMatrixValued);
    recordD(trace, expr, v, 'derivative.product-rule', () => {
      const terms: Expression[] = [];
      expr.ops.forEach((op, i) => {
        const ph = dPlaceholder(op, v);
        if (ph.isSame(0)) return; // constant factor: term drops
        const others = expr.ops.slice();
        if (ordered) {
          others[i] = ph;
          terms.push(ce.function('Multiply', others));
          return;
        }
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
      const gPrime =
        differentiate(op, v, depth + 1, trace) ??
        ce._fn('D', [op, ce.symbol(v)]);
      if (ordered) return productWithFactorReplaced(ce, expr.ops, i, gPrime);
      const otherTerms = expr.ops.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
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
    if (dependsOnVariable(n, v)) {
      const power = ce.function('Power', [base, ce.One.div(n)], {
        form: 'structural',
      });
      recordD(trace, expr, v, 'derivative.rewrite', () =>
        dPlaceholder(power, v)
      );
      return differentiate(power, v, depth + 1, trace);
    }

    if (!dependsOnVariable(base, v)) return ce.Zero;

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

  // The inverse of a matrix function, `Inverse(f)`: with g = f^-1,
  // g' = -g·f'·g. `f^-1` canonicalizes to `Inverse(f)` when `f` is typed as
  // a matrix (`arithmetic-power.ts`), so the rule for a negative power below
  // does not see it: with `f: (real) -> tensor<number>` and
  // `f := x ↦ [[1, x], [x, 2]]`, the call `f(x)` is typed `matrix<real^(2x2)>`
  // and `D(f(x)^-1, x)` stayed an unevaluated derivative of `Inverse`.
  if (
    expr.operator === 'Inverse' &&
    isFunction(expr) &&
    expr.nops === 1 &&
    dependsOnVariable(expr.op1, v)
  ) {
    const f = expr.op1;
    const g = ce.function('Inverse', [f]);
    recordD(trace, expr, v, 'derivative.product-rule', () =>
      ce.function('Multiply', [ce.NegativeOne, g, dPlaceholder(f, v), g])
    );
    const fPrime =
      differentiate(f, v, depth + 1, trace) ?? ce._fn('D', [f, ce.symbol(v)]);
    return simplifyDerivative(
      ce.function('Multiply', [ce.NegativeOne, g, fPrime, g])
    );
  }

  // A positive integer power of a base that may be a matrix, `f^n`, is the
  // product of `n` copies of `f`, and the product rule applies: (f^2)' is
  // f'·f + f·f', not 2f·f' (the matrix product does not commute).
  if (
    (expr.operator === 'Power' || expr.operator === 'MatrixPower') &&
    isFunction(expr) &&
    mayBeMatrixValued(expr.op1) &&
    dependsOnVariable(expr.op1, v) &&
    !dependsOnVariable(expr.op2, v)
  ) {
    // Only an EXACT integer exponent is the matrix power. A float exponent
    // (`f^2.0`) is the entry-wise power, which `D` leaves unevaluated here.
    const n =
      isNumber(expr.op2) && expr.op2.isExact ? asSmallInteger(expr.op2) : null;
    // f^0 is the identity (constant) and f^1 is f.
    if (n === 0) return ce.Zero;
    if (n === 1) return differentiate(expr.op1, v, depth + 1, trace);
    // A negative integer power: with g = f^-1, g' = -g·f'·g, and the product
    // rule over the m = |n| copies of g gives
    // (f^-m)' = -Σ f^-(i+1)·f'·f^-(m-i), i = 0..m-1.
    if (n !== null && n <= -1 && n >= -8) {
      const f = expr.op1;
      const m = -n;
      const inv = (k: number): Expression =>
        ce.function('Power', [f, ce.number(-k)]);
      const terms = (middle: Expression): Expression[] =>
        Array.from({ length: m }, (_, i) =>
          ce.function('Multiply', [
            ce.NegativeOne,
            inv(i + 1),
            middle,
            inv(m - i),
          ])
        );
      recordD(trace, expr, v, 'derivative.product-rule', () =>
        ce.function('Add', terms(dPlaceholder(f, v)))
      );
      const fPrime =
        differentiate(f, v, depth + 1, trace) ?? ce._fn('D', [f, ce.symbol(v)]);
      return simplifyDerivative(add(...terms(fPrime)));
    }
    // Any other exponent (a non-integer, or an integer of large size): the
    // scalar power rule does not hold for a matrix, so `D` stays unevaluated.
    if (n === null || n < -8 || n > 8) return undefined;
    if (n >= 2 && n <= 8) {
      const f = expr.op1;
      const fPlaceholder = dPlaceholder(f, v);
      const power = (k: number): Expression[] =>
        k === 0 ? [] : [k === 1 ? f : ce.function('Power', [f, ce.number(k)])];
      recordD(trace, expr, v, 'derivative.product-rule', () =>
        ce.function(
          'Add',
          Array.from({ length: n }, (_, i) =>
            ce.function('Multiply', [
              ...power(i),
              fPlaceholder,
              ...power(n - 1 - i),
            ])
          )
        )
      );
      const fPrime =
        differentiate(f, v, depth + 1, trace) ?? ce._fn('D', [f, ce.symbol(v)]);
      return simplifyDerivative(
        add(
          ...Array.from({ length: n }, (_, i) =>
            ce.function('Multiply', [...power(i), fPrime, ...power(n - 1 - i)])
          )
        )
      );
    }
  }

  // Power rule
  if (expr.operator === 'Power') {
    const [base, exponent] = expr.ops;
    const baseHasV = dependsOnVariable(base, v);
    const expHasV = dependsOnVariable(exponent, v);

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
        isLibraryExponentialE(base)
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
      // For base e, the factor ln(e) is 1. `Ln(ExponentialE)` does not fold
      // at canonicalization, and a first derivative is not simplified, so
      // without this test `Derivative(Exp)` evaluated to `x ↦ ln(e)·e^x`.
      const lnBase = isLibraryExponentialE(base)
        ? ce.One
        : ce._fn('Ln', [base]);
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
    const xHasV = dependsOnVariable(x, v);
    const baseHasV = dependsOnVariable(base, v);

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

  // Mod(u, c): CE's Mod is the FLOORED remainder, the real sawtooth
  // ((u mod c) + c) mod c, whose result has the sign of c:
  //
  //     Mod(u, c) = u − c·floor(u/c)
  //
  // Between two jumps (where u/c is not an integer) floor(u/c) is constant,
  // so the derivative there is
  //
  //     d/dv Mod(u, c) = u′ − floor(u/c)·c′
  //
  // This holds also when the jump locations move with v: the formula is the
  // derivative at every point that is not on a jump. At a jump Mod has no
  // derivative. The result is u′ when c does not depend on v, and
  // −floor(u/c)·c′ when u does not depend on v.
  if (expr.operator === 'Mod' && expr.nops === 2) {
    const [u, c] = expr.ops;
    const uHasV = dependsOnVariable(u, v);
    const cHasV = dependsOnVariable(c, v);
    if (!uHasV && !cHasV) return ce.Zero;
    const floorQ = ce.function('Floor', [ce.function('Divide', [u, c])]);
    recordD(trace, expr, v, 'derivative.known-derivative', () => {
      const terms: Expression[] = [];
      if (uHasV) terms.push(dPlaceholder(u, v));
      if (cHasV)
        terms.push(
          ce.function('Negate', [
            ce.function('Multiply', [floorQ, dPlaceholder(c, v)]),
          ])
        );
      return terms.length === 1 ? terms[0] : ce.function('Add', terms);
    });
    const terms: Expression[] = [];
    if (uHasV)
      terms.push(
        differentiate(u, v, depth + 1, trace) ?? ce._fn('D', [u, ce.symbol(v)])
      );
    if (cHasV) {
      const cPrime =
        differentiate(c, v, depth + 1, trace) ?? ce._fn('D', [c, ce.symbol(v)]);
      terms.push(floorQ.mul(cPrime).neg());
    }
    return simplifyDerivative(add(...terms));
  }

  // Discrete functions: GCD, LCM, and the integer-valued counts `Length`
  // and `Count`. These are step functions with derivative 0 almost
  // everywhere (undefined at discontinuities, but we return 0 as a useful
  // approximation). The length of a list literal does not change with the
  // values of its elements at all: `D(Length([x]), x)` is 0; it was the
  // list `[Apply(Derivative("Length", 1), [x])]` from the generic chain
  // rule, which broadcast over the list operand.
  if (['GCD', 'LCM', 'Length', 'Count'].includes(expr.operator)) {
    recordD(trace, expr, v, 'derivative.zero', () => ce.Zero);
    return ce.Zero;
  }

  // The step forms `Round(u, a)`, `Floor(u, a)`, `Ceil(u, a)` and
  // `Truncate(u, a)` round u to a multiple of the step a: a step function of
  // u, so the derivative in u is 0 almost everywhere, as for the
  // one-argument forms of the table. As a function of the step, the result
  // `k·|a|` is not constant (its derivative is `±k` between the jumps): if
  // the step depends on v, stay symbolic.
  if (
    (expr.operator === 'Round' ||
      expr.operator === 'Floor' ||
      expr.operator === 'Ceil' ||
      expr.operator === 'Truncate') &&
    expr.nops === 2
  ) {
    const [u, n] = expr.ops;
    if (dependsOnVariable(n, v)) return ce._fn('D', [expr, ce.symbol(v)]);
    if (dependsOnVariable(u, v))
      recordD(trace, expr, v, 'derivative.zero', () => ce.Zero);
    return ce.Zero;
  }

  // Gamma(s, z) is the upper incomplete gamma function ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt.
  // Its partial derivative in z is −z^(s−1)·e^(−z) (the fundamental theorem
  // of calculus). Its partial derivative in s has no elementary closed form:
  // keep it symbolic as Apply(Derivative(Gamma, 1, 0), s, z), times s′.
  if (expr.operator === 'Gamma' && expr.nops === 2) {
    const [s, z] = expr.ops;
    const sHasV = dependsOnVariable(s, v);
    const zHasV = dependsOnVariable(z, v);
    if (!sHasV && !zHasV) return ce.Zero;
    const dz = ce
      .function('Multiply', [
        ce.function('Power', [z, ce.function('Subtract', [s, ce.One])]),
        ce.function('Exp', [ce.function('Negate', [z])]),
      ])
      .neg();
    const dsApplied = ce._fn('Apply', [
      ce._fn('Derivative', [ce.symbol('Gamma'), ce.One, ce.Zero]),
      s,
      z,
    ]);
    recordD(trace, expr, v, 'derivative.known-derivative', () => {
      const terms: Expression[] = [];
      if (sHasV)
        terms.push(ce.function('Multiply', [dsApplied, dPlaceholder(s, v)]));
      if (zHasV) terms.push(ce.function('Multiply', [dz, dPlaceholder(z, v)]));
      return terms.length === 1 ? terms[0] : ce.function('Add', terms);
    });
    const terms: Expression[] = [];
    if (sHasV) {
      const sPrime =
        differentiate(s, v, depth + 1, trace) ?? ce._fn('D', [s, ce.symbol(v)]);
      terms.push(dsApplied.mul(sPrime));
    }
    if (zHasV) {
      const zPrime =
        differentiate(z, v, depth + 1, trace) ?? ce._fn('D', [z, ce.symbol(v)]);
      terms.push(dz.mul(zPrime));
    }
    return simplifyDerivative(add(...terms));
  }

  // PolyLog(s, z) is the polylogarithm Li_s(z) = Σ_{k≥1} z^k/k^s. Its partial
  // derivative in z is Li_{s−1}(z)/z: term by term, z·d/dz (z^k/k^s) is
  // z^k/k^(s−1). The analytic continuation outside the unit disk keeps this
  // identity. Li_{s−1} then reduces where the engine has a closed form:
  // s = 2 gives −ln(1 − z)/z, and s = 1 gives Li_0(z)/z = 1/(1 − z). The
  // partial derivative in s has no closed form: keep it symbolic as
  // Apply(Derivative(PolyLog, 1, 0), s, z), times s′.
  if (expr.operator === 'PolyLog' && expr.nops === 2) {
    const [s, z] = expr.ops;
    const sHasV = dependsOnVariable(s, v);
    const zHasV = dependsOnVariable(z, v);
    if (!sHasV && !zHasV) return ce.Zero;
    const dz = ce.function('Divide', [
      ce.function('PolyLog', [ce.function('Subtract', [s, ce.One]), z]),
      z,
    ]);
    const dsApplied = ce._fn('Apply', [
      ce._fn('Derivative', [ce.symbol('PolyLog'), ce.One, ce.Zero]),
      s,
      z,
    ]);
    recordD(trace, expr, v, 'derivative.known-derivative', () => {
      const terms: Expression[] = [];
      if (sHasV)
        terms.push(ce.function('Multiply', [dsApplied, dPlaceholder(s, v)]));
      if (zHasV) terms.push(ce.function('Multiply', [dz, dPlaceholder(z, v)]));
      return terms.length === 1 ? terms[0] : ce.function('Add', terms);
    });
    const terms: Expression[] = [];
    if (sHasV) {
      const sPrime =
        differentiate(s, v, depth + 1, trace) ?? ce._fn('D', [s, ce.symbol(v)]);
      terms.push(dsApplied.mul(sPrime));
    }
    if (zHasV) {
      const zPrime =
        differentiate(z, v, depth + 1, trace) ?? ce._fn('D', [z, ce.symbol(v)]);
      terms.push(dz.mul(zPrime));
    }
    return simplifyDerivative(add(...terms));
  }

  // PolyGamma(m, u): d/du ψ⁽ᵐ⁾(u) = ψ⁽ᵐ⁺¹⁾(u), so the derivative climbs the
  // order ladder. Only ∂/∂u is elementary; an order that depends on v has no
  // closed form — stay symbolic (inert rather than wrong).
  if (expr.operator === 'PolyGamma' && expr.nops === 2) {
    const [m, u] = expr.ops;
    if (dependsOnVariable(m, v)) return ce._fn('D', [expr, ce.symbol(v)]);
    if (!dependsOnVariable(u, v)) return ce.Zero;
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
    if (dependsOnVariable(k, v)) return ce._fn('D', [expr, ce.symbol(v)]);
    if (!dependsOnVariable(z, v)) return ce.Zero;
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
    const xHasV = dependsOnVariable(x, v);
    const orderHasV = dependsOnVariable(order, v);

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

  // `Abs` of a NON-NUMBER operand is the Euclidean norm, not a scalar
  // absolute value: `|(x, y, z)| = √(|x|² + |y|² + |z|²)`. The table's entry
  // (`Abs: ['Sign', '_']`) is the scalar rule and is wrong for that operand —
  // applied through the chain rule below it produced
  // `Sign((cos t, 1)) · (−sin t, 0)`, a tuple multiplied by a tuple, which
  // surfaced either as a nonsense value or as an `incompatible-type`
  // tuple/number error depending on what enclosed it. The norm's derivative
  // is the projection of the component velocities onto the unit vector:
  //
  //     d|v|/dt = (Σᵢ vᵢ · vᵢ′) / |v|
  //
  // That is the REAL Euclidean form. The norm also accepts COMPLEX
  // components, where the correct numerator is `Re(Σ conj(vᵢ)·vᵢ′)` — for
  // `|(t + i, 2)|` the real form answers `0.667 + 0.333i` at t = 2 where the
  // derivative is the real `0.667`, a right real part with a spurious
  // imaginary one. So a component that is provably NON-real declines here
  // rather than taking the real form. (The Hermitian numerator is not emitted
  // instead because neither `Re` nor `Conjugate` folds away for a
  // provably-real argument: emitting them would leave
  // `Re(-(sin t · Conjugate(cos t)))` in ordinary real output and evaluate to
  // NaN. Supporting complex components properly needs those two to reduce
  // first, which is a separate piece of work.) A component whose realness is
  // merely UNKNOWN — `cos(t)` for a free `t` — takes the real form, the same
  // assumption the scalar rules in the table make.
  //
  // Undefined at `v = 0`, exactly as the scalar rule is undefined at 0.
  // Verified numerically against a central difference, including a complex
  // component, before landing.
  if (
    expr.operator === 'Abs' &&
    expr.nops === 1 &&
    expr.op1.isNumber !== true
  ) {
    // A norm that does not mention `v` is constant in `v`, whatever its
    // components are — including an opaque operand this rule cannot take
    // apart. Answering `0` here matters because it is what the code did
    // BEFORE this branch existed: the scalar rule composed with `D(V, v) = 0`
    // gave `Sign(V)·0 = 0`, so declining instead would REGRESS
    // `D(|V|, t)` for a `V: list<number>` from `0` to inert.
    if (!dependsOnVariable(expr, v)) return ce.Zero;

    const vec = expr.op1;
    const comps = isFunction(vec, 'Tuple') ? vec.ops : null;
    // The norm of an empty vector is `0` for every norm type (see `Norm` in
    // `library/linear-algebra.ts`), and `|()|` already evaluates to `0`, so
    // its derivative is `0` rather than a decline.
    if (comps?.length === 0) return ce.Zero;
    // Beyond that, only a tuple has statically-known components to
    // differentiate. Any other non-number operand that DOES mention `v` (an
    // opaque collection, a symbol typed `list<…>` with a `v`-dependent
    // binding) declines, leaving `D` inert rather than guessing — a decline
    // is a correct answer there, a scalar rule is not.
    if (!comps) return undefined;

    // `Real(Conjugate(vᵢ) · vᵢ′)` rather than the bare product, because the
    // operand's components may be complex. The two forms agree whenever the
    // component is real, and the bare product is worth keeping there: it is
    // the form that COLLAPSES. `d/dt |(cos t, −sin t, 1)|` is `0` as a bare
    // product and a 112-character non-reducing expression as a Hermitian one
    // (`Real`/`Conjugate` do not fold away over a symbolic argument), which
    // matters to a caller that re-serializes derivatives inside a size-capped
    // expansion loop — it spends budget rather than failing, so the loss is
    // silent.
    //
    // `isExtendedReal === true` means PROVABLY real, so the bare product is
    // taken only where realness is established and the Hermitian form is the
    // conservative default. Note what this does NOT buy, because the obvious
    // reading is wrong: `D` BINDS its variable, so inside the differentiation
    // the variable is a bound symbol typed `unknown` no matter what the
    // enclosing scope declared — with `t` declared `real`,
    // `D(|(t, 2)|, t)` still takes the Hermitian branch, because `t` is not
    // that `t` here. The guard therefore fires for components that are real
    // WITHOUT depending on the bound variable (literals: `D(|(1, 2)|, t)`
    // collapses to `0`), and not for the `cos(t)` shapes where the collapse
    // would matter most. Recovering those needs the bound variable to carry
    // the declared type — separate work, not a tweak to this guard.
    const numeratorTerm = (c: Expression, cPrime: Expression): Expression =>
      c.isExtendedReal === true && cPrime.isExtendedReal === true
        ? ce.function('Multiply', [c, cPrime])
        : ce.function('Real', [
            ce.function('Multiply', [ce.function('Conjugate', [c]), cPrime]),
          ]);

    const terms: Expression[] = [];
    for (const c of comps) {
      const cPrime = differentiate(c, v, depth + 1, trace);
      if (cPrime === undefined) return undefined;
      terms.push(numeratorTerm(c, cPrime));
    }
    recordD(trace, expr, v, 'derivative.tuple-norm', () =>
      ce.function('Divide', [
        add(...comps.map((c) => numeratorTerm(c, dPlaceholder(c, v)))),
        expr,
      ])
    );
    return simplifyDerivative(
      ce.function('Divide', [add(...terms), expr]) as Expression
    );
  }

  const h = DERIVATIVES_TABLE[
    expr.operator as keyof typeof DERIVATIVES_TABLE
  ] as ExpressionInput | undefined;
  if (h === undefined)
    return differentiateUnknownApplication(expr, v, depth, trace);

  // Apply the chain rule:
  // d/dx f(g(x)) = f'(g(x)) * g'(x)
  if (expr.nops > 1) return ce._fn('D', [expr, ce.symbol(v)]);
  const g = expr.ops[0];
  // Substitute the argument into the derivative formula
  // We use subs() instead of apply() to avoid evaluating the expression,
  // which would convert symbolic transcendentals like ln(10) to numeric values.
  const derivFormula = scaleForAngularUnit(
    ce.expr(h).subs({ _: g }),
    expr.operator
  );
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

/**
 * The largest number of factors a `Product` is expanded to before it is
 * differentiated (see `differentiateBigOp()`). The product rule writes one
 * term per factor, and each term repeats the other factors, so the size of
 * the derivative grows with the square of this number.
 */
const MAX_EXPANDED_PRODUCT_FACTORS = 24;

/**
 * Whether an indexing set of a `Sum` has infinitely many values: a `Limits`
 * clause with an infinite bound or with no bounds (`\sum_k f` runs over
 * `1..+∞`), or an `Element` clause whose collection is not known to be
 * finite (`k ∈ ℕ`).
 */
function isInfiniteIndexingSet(set: Expression): boolean {
  if (isFunction(set, 'Limits')) {
    if (isSymbol(set.op2, 'Nothing') && isSymbol(set.op3, 'Nothing'))
      return true;
    return set.op2.isInfinity === true || set.op3.isInfinity === true;
  }
  if (isFunction(set, 'Element'))
    return set.op2 === undefined || set.op2.isFiniteCollection !== true;
  return false;
}

/** Whether `expr` has a subexpression with the operator `op`. */
function containsOperator(expr: Expression, op: string): boolean {
  if (!isFunction(expr)) return false;
  return expr.operator === op || expr.ops.some((x) => containsOperator(x, op));
}

/**
 * Whether `expr` can call the user function `name`: it names `name`, as the
 * operator of a call or as a symbol (a function passed as an argument,
 * `G(f, x)`), or it names a user function whose literal can call `name`, at
 * any depth (`f` calls `g`, which calls `f`). Each function literal is
 * walked once.
 */
function reachesUserFunction(expr: Expression, name: string): boolean {
  const ce = expr.engine;
  const followed = new Set<string>();
  const visited = new Set<Expression>();
  const pending: Expression[] = [expr];
  while (pending.length > 0) {
    const e = pending.pop()!;
    if (visited.has(e)) continue;
    visited.add(e);
    let callee: Expression | undefined;
    if (isSymbol(e)) callee = e;
    else if (isFunction(e)) {
      if (e.operator === name) return true;
      if (e._numericStore === undefined) pending.push(...e.ops);
      if (!followed.has(e.operator)) callee = ce.symbol(e.operator);
    }
    if (callee === undefined || !isSymbol(callee)) continue;
    if (callee.symbol === name) return true;
    if (followed.has(callee.symbol)) continue;
    followed.add(callee.symbol);
    if (!isUserFunction(callee)) continue;
    const literal = userFunctionLiteral(callee);
    if (literal !== undefined && isFunction(literal)) pending.push(literal.op1);
  }
  return false;
}

/**
 * Whether `expr` can depend on the variable `v`.
 *
 * `expr.has(v)` sees only the names written in `expr`. A call of a user
 * function also depends on `v` when the body of the function reads `v`: with
 * `g := a ↦ a·x`, `g(k)` depends on `x`, and the derivative of the call,
 * which expands the body (`differentiateUnknownApplication()`), is `k`. So a
 * call is followed into the body of its function, and into the calls that
 * this body makes. A function with no known body depends on `v` only through
 * its arguments, as the chain rule reads it.
 *
 * Every rule of `differentiateNode()` that answers 0 for an operand that
 * does not depend on `v` uses this test, not `has(v)`: the body of a user
 * function is differentiated as it is written (`userFunctionBody()`), so it
 * can hold a call such as `g(k)` in `g(k)²`, with `g := t ↦ t·x`, whose
 * derivative is not 0. A function that is being
 * followed already (a recursive definition) adds nothing new when it is met
 * again, so it is not followed a second time.
 *
 * A bare symbol that names a user function (`h` in `G(h, k)`, where `h` is
 * passed to `G` as an argument) is followed too, as `differentiate()` expands
 * it: its body is the function applied to the wildcard `_`.
 *
 * The body of a function is found with wildcards in place of its parameters
 * (`userFunctionBody()`): from its literal when it has one, otherwise by
 * evaluating the function applied to the wildcards. A function that is not
 * pure (its body draws a random number, or writes a variable) is not
 * followed: the evaluation would run these effects. Such a function may
 * depend on `v`, so the answer is then `true`, and a bound that calls it
 * keeps the derivative unevaluated.
 *
 * The expression is walked once: each node is visited once, also when it is
 * shared, and the body of each function (its name and its number of
 * arguments) is followed once. The names written in the expression are
 * tested before any body is followed.
 */
function dependsOnVariable(expr: Expression, v: string): boolean {
  const ce = expr.engine;
  // The nodes already walked, in `expr` and in the bodies followed.
  const visited = new Set<Expression>();
  // For each function followed (keyed by its name and its number of
  // arguments), whether its body depends on `v`. The entry is `false` while
  // the body is being walked, so that a recursive definition that meets the
  // function again does not follow it a second time.
  const followed = new Map<string, boolean>();

  const follow = (name: string, nargs: number, fn?: Expression): boolean => {
    const key = `${name}/${nargs}`;
    const known = followed.get(key);
    if (known !== undefined) return known;
    followed.set(key, false);
    fn ??= ce.symbol(name);
    if (!isUserFunction(fn)) return false;
    const wildcards =
      nargs === 1
        ? [ce.symbol('_')]
        : Array.from({ length: nargs }, (_, i) => ce.symbol(`_${i + 1}`));
    // A function with effects is not followed to find its body: it may
    // depend on `v`. The body of a literal is walked as it is written, with
    // its parameter names: the arguments of each call are walked at the
    // call. A function with no literal is applied to wildcards and
    // evaluated (`userFunctionBody()`). A body that is not valid is not
    // known: the evaluation can give an `Error` (a wildcard is not a
    // function), which no longer holds the names of the body.
    let result = true;
    if (ce.function(name, wildcards).isPure) {
      const literal = userFunctionLiteral(fn);
      let body: Expression | undefined;
      if (literal !== undefined && isFunction(literal, 'Function')) {
        body = literal.op1;
        if (isFunction(body, 'Block')) body = blockValue(ce, body);
        // A parameter with the name of the variable (`q(x) := x²`) is not
        // the variable: it is replaced by a wildcard before the walk.
        const params = literal.ops
          .slice(1)
          .map((p) => functionLiteralParameterName(p));
        if (body !== undefined && params.includes(v))
          body = body.subs({ [v]: ce.symbol('_') });
      }
      body ??= userFunctionBody(fn, wildcards);
      result = body !== undefined && (!body.isValid || walk(body));
    }
    followed.set(key, result);
    return result;
  };

  const walk = (root: Expression): boolean => {
    // The functions to follow once the names written in `root` are tested.
    const calls: { name: string; nargs: number; fn?: Expression }[] = [];
    const pending: Expression[] = [root];
    while (pending.length > 0) {
      const e = pending.pop()!;
      if (visited.has(e)) continue;
      visited.add(e);
      if (isSymbol(e)) {
        if (e.symbol === v) return true;
        calls.push({ name: e.symbol, nargs: 1, fn: e });
        continue;
      }
      // A dictionary is not a function: its values are not operands. Its
      // `has()` tests whether a KEY is present (`DictionaryInterface`), not
      // whether a symbol occurs in it, so its values are walked.
      if (isDictionary(e)) {
        for (const value of e.values) pending.push(value);
        continue;
      }
      if (!isFunction(e)) {
        if (e.has(v)) return true;
        continue;
      }
      if (e.operator === v) return true;
      calls.push({ name: e.operator, nargs: e.nops });
      // A store-backed list has only number operands, which never depend on
      // `v`, so it is not walked (and its elements are not boxed).
      if (e._numericStore !== undefined) continue;
      // A function literal with a parameter named `v` (`x ↦ x` in
      // `Length([x ↦ x])`) binds each `v` that it holds: the literal is a
      // function, the same function for every value of `v`.
      if (
        e.operator === 'Function' &&
        e.ops.slice(1).some((p) => functionLiteralParameterName(p) === v)
      )
        continue;
      for (const op of e.ops) pending.push(op);
    }
    return calls.some(({ name, nargs, fn }) => follow(name, nargs, fn));
  };

  return walk(expr);
}

/**
 * Whether a bound of a big operator that depends on `v` is constant between
 * its jumps: its derivative in `v` is 0. The derivative of a step function
 * is 0 away from its jumps (`D(⌊x⌋)` is `0`), so `⌊x⌋`, `⌈x/2⌉`,
 * `round(2x)` and `x − (x mod 1)` qualify, and `x` or `x/2` do not. Only
 * a step that the derivative reduces to 0 qualifies: `Floor`, `Ceil`,
 * `Round`, `Truncate` and `Sign` of the variable; a step whose derivative
 * stays symbolic (`Heaviside`, `If(1 < x, 3, 5)`) does not, and the sum
 * keeps its `D`. The
 * derivative is computed with no trace: it is a test, not a step of the
 * result. A bound that is not pure does not qualify: a call of a function
 * whose body draws a random number has a derivative of 0 because the body
 * does not mention `v`, but its value changes from one evaluation to the
 * next.
 */
function isStepBound(bound: Expression, v: string, depth: number): boolean {
  if (!bound.isPure) return false;
  const d = differentiate(bound, v, depth + 1);
  return d !== undefined && d.isValid && d.isSame(0);
}

/**
 * The derivative of a `Sum` or a `Product` with respect to `v`.
 *
 * The derivative is computed only when every indexing set is a `Limits`
 * clause (or, for a `Sum`, an `Element` clause) whose bounds, collection and
 * condition do not depend on `v`, also through a call of a user function
 * whose body reads `v` (`dependsOnVariable()`). A bound that depends on `v` changes the set
 * of terms with `v`, and a clause with one `Nothing` (absent) bound gives no
 * definite set of terms: the derivative then stays unevaluated
 * (`undefined`). A `Limits` clause with no bounds at all runs over
 * `1..+∞`, as an explicit infinite range does.
 *
 * One exception, for a `Sum`: a `Limits` bound that depends on `v` only
 * through a step (`⌊x⌋`, `⌈x⌉`, `round(2x)`), so that its derivative is 0
 * (`isStepBound()`). Between two jumps of the bound the set of terms is
 * fixed, and the derivative there is the sum of the derivatives of the
 * terms, with the same bounds: `d/dx Σ_{i=1}^{⌊x⌋} cos(i x)` is
 * `Σ_{i=1}^{⌊x⌋} −i sin(i x)`. At a jump the sum is not continuous and has
 * no derivative; the result there is the value of that sum, as `D(⌊x⌋)` is
 * `0` at an integer (Tycho row 420).
 *
 * When `v` is the index of one of the indexing sets, every `v` in the body is
 * that index, not the variable of differentiation. The operator is then a
 * constant in `v`, and its derivative is 0. The same is true when the body
 * does not depend on `v`: it does not mention `v`, and it calls no user
 * function whose body reads `v`.
 *
 * `Sum`: the sum rule applied term by term,
 *
 *     d/dv Σ_k f(k, v) = Σ_k d/dv f(k, v)
 *
 * with the same indexing sets. For a finite range this is the sum rule. For
 * an infinite range it is the formal term-by-term derivative, which is the
 * value of the derivative where the series of derivatives converges
 * uniformly (a power series inside its radius of convergence, for example).
 * The new sum is built with `ce.function('Sum', …)` on the scope of the
 * original sum, where the index in the new body is already bound. The index
 * symbol is never made with `ce.symbol()`.
 *
 * `Product`: the product is expanded into its factors, and the product rule
 * is applied to them. This is done only when every bound is an integer
 * literal no larger in magnitude than 2^53 − 1 (a safe integer) and the
 * total number of factors is at most
 * `MAX_EXPANDED_PRODUCT_FACTORS`. Other products stay unevaluated. Two other
 * forms were not used:
 * - The logarithmic derivative, (∏f)·Σ(f′/f), divides by each factor, so it
 *   is not defined when a factor is 0 at the point.
 * - The form Σ_j f′_j·∏_{k<j} f_k·∏_{k>j} f_k is correct for a symbolic
 *   range, but it needs a new index for the outer sum and bounds that depend
 *   on it, and for an infinite range it has convergence conditions that the
 *   engine cannot check.
 * The expansion substitutes each index value into the body by name. When a
 * binder inside the body binds a name of an index (or a name that a bound
 * mentions), that substitution could capture it, so the derivative stays
 * unevaluated.
 */
function differentiateBigOp(
  expr: Expression & FunctionInterface,
  v: string,
  depth: number,
  trace: DerivativeTrace | undefined
): Expression | undefined {
  const ce = expr.engine;
  const isSum = expr.operator === 'Sum';
  const [body, ...sets] = expr.ops;
  // A big operator without an indexing set is the reduction of a collection
  // (`Sum([1, 2, 3])`): it is not a function of a term, so decline.
  if (body === undefined || sets.length === 0) return undefined;

  const indexes: string[] = [];
  for (const set of sets) {
    let index: Expression | undefined;
    let others: ReadonlyArray<Expression>;
    if (isFunction(set, 'Limits') && set.nops === 3) {
      index = set.op1;
      others = [set.op2, set.op3];
    } else if (isSum && isFunction(set, 'Element') && set.nops >= 2) {
      index = set.op1;
      others = set.ops.slice(1);
    } else return undefined;
    if (!isSymbol(index) || index.symbol === 'Nothing') return undefined;
    // A `Limits` clause with no bounds (`\sum_k x^k`) runs over `k = 1..+∞`
    // (`withDefaultBigOpBounds()` in `library/utils.ts`), so it is
    // differentiated as `\sum_{k=1}^{\infty} x^k` is. A clause with one
    // bound only is absent on one side: the sum or product then has no
    // definite set of terms, so its derivative stays unevaluated.
    const noBounds =
      isFunction(set, 'Limits') &&
      isSymbol(set.op2, 'Nothing') &&
      isSymbol(set.op3, 'Nothing');
    // A bound of a `Sum` that depends on `v` but is constant between its
    // jumps (`⌊x⌋`): see `isStepBound()`.
    const fixedBound = (x: Expression): boolean =>
      !dependsOnVariable(x, v) ||
      (isSum && isFunction(set, 'Limits') && isStepBound(x, v, depth));
    if (
      !noBounds &&
      others.some((x) => isSymbol(x, 'Nothing') || !fixedBound(x))
    )
      return undefined;
    indexes.push(index.symbol);
  }

  if (indexes.includes(v) || !dependsOnVariable(body, v)) {
    recordD(trace, expr, v, 'derivative.zero', () => ce.Zero);
    return ce.Zero;
  }

  if (isSum) {
    const infinite = sets.some(isInfiniteIndexingSet);
    // Over an infinite range, a sum with a closed form is differentiated
    // through it: `Σ_{k≥1} x^k/k!` is `e^x − 1`, whose derivative is `e^x`.
    // The closed form holds on an open set (`|x| < 1` for `Σ_{k≥1} x^k`,
    // kept as the condition of a `When`), so its derivative is the
    // derivative of the sum there.
    // The rewrite of the sum to its closed form is recorded as a step, so
    // `explain('D')` shows it before the steps of its derivative. If the
    // closed form cannot be differentiated, the steps recorded for it are
    // removed and the term-by-term derivative is tried.
    if (infinite) {
      const closed = expr.evaluate();
      if (!containsOperator(closed, 'Sum')) {
        const mark = trace?.length ?? 0;
        if (isFunction(closed, 'When') && closed.nops === 2) {
          recordD(trace, expr, v, 'derivative.rewrite', () =>
            ce._fn('When', [dPlaceholder(closed.op1, v), closed.op2])
          );
          const d = differentiate(closed.op1, v, depth + 1, trace);
          if (d !== undefined && d.isValid)
            return ce.function('When', [d, closed.op2]);
        } else {
          recordD(trace, expr, v, 'derivative.rewrite', () =>
            dPlaceholder(closed, v)
          );
          const d = differentiate(closed, v, depth + 1, trace);
          if (d !== undefined && d.isValid) return d;
        }
        if (trace) trace.length = mark;
      }
    }
    // The template keeps the scope of the original sum, so the index in
    // `D(body, v)` is the same binding as in `body`: `explainD()` finds the
    // later steps' nodes in it with `isSame()`, which compares bindings.
    const mark = trace?.length ?? 0;
    recordD(trace, expr, v, 'derivative.term-by-term', () =>
      ce._fn('Sum', [dPlaceholder(body, v), ...sets], {
        scope: expr.localScope,
      })
    );
    const dBody = differentiate(body, v, depth + 1, trace);
    if (dBody === undefined || !dBody.isValid) return undefined;
    // The derivative of a call of a user function is the derivative of the
    // body of that function, and that body can read a symbol with the name
    // of an index: with `k := 2` and `g := a ↦ a·k·x`, the derivative of
    // the term `g(k)` is `k·k`, where the first `k` is the index and the
    // second is the global `k`. A sum built on this term binds both by name,
    // and gave `Σ k² = 55` instead of `Σ 2k = 30`. When this occurs, the
    // index is renamed to a fresh name and the renamed sum is
    // differentiated. The steps recorded for the first attempt are removed.
    const renamed = renameCapturedIndexes(expr, dBody, indexes, v);
    if (renamed !== undefined) {
      if (trace) trace.length = mark;
      if (renamed === null) return undefined;
      recordD(trace, expr, v, 'derivative.rewrite', () =>
        dPlaceholder(renamed, v)
      );
      const d = differentiate(renamed, v, depth + 1, trace);
      if (d === undefined || !d.isValid) {
        if (trace) trace.length = mark;
        return undefined;
      }
      return d;
    }
    // The index in `dBody` and in `sets` is bound in the scope of the
    // original sum, so the new sum is built on that scope. A new scope would
    // have a different parent, and an index named like a library constant
    // (`i`, `e`) could then resolve to the constant (docs/SCOPING-MODEL.md,
    // "Rebuilding a scoped node").
    const dSum = ce.function('Sum', [dBody, ...sets], {
      scope: expr.localScope,
    });
    // Over an infinite range, the series of derivatives can diverge where
    // the series converges: `Σ_{k≥1} sin(kx)/k` converges, but
    // `Σ_{k≥1} cos(kx)` does not, and the derivative is −1/2 on (0, 2π).
    // The engine cannot check uniform convergence, so the term-by-term
    // derivative is kept only when the series of derivatives evaluates to
    // a closed form (`Σ_{k≥1} k·x^(k−1)` is `1/(1 − x)²` for |x| < 1).
    // Otherwise the derivative stays unevaluated.
    if (infinite) {
      const value = dSum.evaluate();
      if (containsOperator(value, 'Sum')) return undefined;
      return value;
    }
    return dSum;
  }

  // Product: expand a small finite range into its factors.
  const ranges: [string, number, number][] = [];
  let count = 1;
  for (const [i, set] of sets.entries()) {
    // Every set is a `Limits` clause here: `Element` is accepted only for a
    // `Sum`.
    if (!isFunction(set)) return undefined;
    const [lower, upper] = [set.op2, set.op3];
    if (
      !isNumber(lower) ||
      !isNumber(upper) ||
      lower.isInteger !== true ||
      upper.isInteger !== true
    )
      return undefined;
    const lo = lower.re;
    const hi = upper.re;
    // Above 2^53 a machine number cannot hold every integer: `n++` would not
    // change `n`, and the loop below would never end.
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi))
      return undefined;
    count *= Math.max(0, hi - lo + 1);
    if (count > MAX_EXPANDED_PRODUCT_FACTORS) return undefined;
    ranges.push([indexes[i], lo, hi]);
  }
  const binders = collectBinderNames(body);
  if (indexes.some((index) => binders.has(index))) return undefined;

  // Every combination of index values, the first indexing set varying
  // slowest. The maps have no prototype: `subs()` reads `map[name]`, and with
  // a plain object a symbol named `constructor` or `toString` in the body
  // would read an inherited property.
  let substitutions: Record<string, Expression>[] = [Object.create(null)];
  for (const [index, lo, hi] of ranges) {
    const next: Record<string, Expression>[] = [];
    for (const s of substitutions)
      for (let n = lo; n <= hi; n++) {
        const m: Record<string, Expression> = Object.assign(
          Object.create(null),
          s
        );
        m[index] = ce.number(n);
        next.push(m);
      }
    substitutions = next;
  }
  const factors = substitutions.map((s) => body.subs(s));
  // An empty range: the product is 1.
  if (factors.length === 0) return ce.Zero;
  const expanded =
    factors.length === 1 ? factors[0] : ce.function('Multiply', factors);
  recordD(trace, expr, v, 'derivative.rewrite', () =>
    dPlaceholder(expanded, v)
  );
  return differentiate(expanded, v, depth + 1, trace);
}

/**
 * The sum `expr` with each index that `dBody` captures renamed to a fresh
 * name, or `undefined` when `dBody` captures no index.
 *
 * `dBody` is the derivative of the body of `expr`. It captures the index `k`
 * when it holds a free symbol `k` that is not bound to the index: a symbol
 * of the body of a called user function, such as the global `k` in
 * `g := a ↦ a·k·x`. A sum built on `dBody` binds such a symbol to the index
 * by name. In the renamed sum, `Σ_{k_1=1}^{5} g(k_1)`, the body of `g` has
 * the global `k` and the index `k_1`, which are different names.
 *
 * The fresh name is not a name of `expr` or of `dBody`, and it is not the
 * differentiation variable `v`, so the derivative of the renamed sum does not
 * capture it. `v` is reserved separately: it can occur only in the body of a
 * called function and be removed by the differentiation, and an index named
 * `v` makes the derivative 0. Another name of a called body that is not in
 * `dBody` is a term that does not depend on `v`: it is removed again from
 * the derivative of the renamed sum, so it cannot be captured.
 *
 * Only the occurrences of the index are renamed, on the boxed operands, and
 * the renamed sum is built from them: every other symbol keeps its binding.
 * A symbol with the name of the index of an enclosing sum stays bound to
 * that index (a sum boxed again from MathJSON bound it by name in the
 * ambient scope, as a global or, for `i`, as the imaginary unit).
 *
 * Returns `null` when `dBody` captures an index that this function made: the
 * renamed sum is not renamed a second time, and the derivative stays
 * unevaluated.
 */
function renameCapturedIndexes(
  expr: Expression & FunctionInterface,
  dBody: Expression,
  indexes: ReadonlyArray<string>,
  v: string
): Expression | null | undefined {
  const ce = expr.engine;
  const bindings = boundVariableBindings(expr);
  if (bindings === undefined) return undefined;
  const captured = new Set<string>();
  rewriteWithBinders(dBody, (s, shadowed) => {
    if (!indexes.includes(s.symbol) || shadowed?.has(s.symbol)) return s;
    // An occurrence with no definition is the index: the parser leaves the
    // symbols of a binder unbound until it is canonicalized.
    const index = bindings.get(s.symbol);
    const def = s.valueDefinition;
    if (index && def !== undefined && !sameBindingDef(def, index))
      captured.add(s.symbol);
    return s;
  });
  if (captured.size === 0) return undefined;
  const madeHere = expr.localScope && RENAMED_INDEXES.get(expr.localScope);
  if (madeHere && [...captured].some((name) => madeHere.has(name))) return null;

  const used = new Set<string>([
    v,
    ...expr.symbols,
    ...dBody.symbols,
    ...collectBinderNames(expr),
    ...collectBinderNames(dBody),
  ]);
  // The scope of the renamed sum has the parent of the scope of `expr`, so
  // the names that `expr` reads from enclosing binders resolve as they did.
  // Each fresh index is declared in it with the type of the index it
  // replaces, before the occurrences are renamed: the new occurrences are
  // the bindings of this scope, and the sum built on it keeps them.
  const scope: Scope = {
    parent: expr.localScope?.parent ?? ce.context.lexicalScope,
    bindings: new Map(),
  };
  const fresh = new Map<string, Expression>();
  const freshNames = new Set<string>();
  for (const name of captured) {
    let i = 1;
    while (used.has(`${name}_${i}`)) i += 1;
    const id = `${name}_${i}`;
    used.add(id);
    freshNames.add(id);
    const index = bindings.get(name);
    ce._inScope(scope, () =>
      ce.declare(id, {
        type: index?.type ?? 'unknown',
        inferred: index?.inferredType ?? true,
      })
    );
    const symbol = ce._bindingSymbol(id, scope);
    if (symbol === undefined) return null;
    fresh.set(name, symbol);
  }
  RENAMED_INDEXES.set(scope, freshNames);
  // Rename the occurrences of the indexes that are in scope in the operand
  // `i` of the sum: in the body, every index; in an indexing set, its own
  // index and the indexes of the sets before it. A nested binder with the
  // same name keeps its own variable, and a symbol with the name of an index
  // but another binding (the global `k`) keeps its name.
  const rename = (e: Expression, i: number): Expression => {
    const inScope = new Set(
      boundVariableNamesInOperand(expr, i).filter((n) => fresh.has(n))
    );
    if (inScope.size === 0) return e;
    return rewriteWithBinders(e, (s, shadowed) => {
      if (!inScope.has(s.symbol) || shadowed?.has(s.symbol)) return s;
      const def = s.valueDefinition;
      if (
        def !== undefined &&
        !sameBindingDef(def, bindings.get(s.symbol) ?? undefined)
      )
        return s;
      return fresh.get(s.symbol)!;
    });
  };
  return ce.function(
    expr.operator,
    expr.ops.map((op, i) => rename(op, i)),
    { scope }
  );
}

/**
 * The scopes of the sums that `renameCapturedIndexes()` made, with the fresh
 * names of their indexes. A capture of one of these names is not repaired a
 * second time.
 */
const RENAMED_INDEXES = new WeakMap<Scope, ReadonlySet<string>>();

/**
 * The derivative of an application of an operator with no entry in the
 * derivative table: an operator the user defined, or an unknown function.
 *
 * A user function is resolved by applying it to wildcards and evaluating; when
 * that gives its body, the body is differentiated. Otherwise the derivative
 * stays symbolic and the multivariate chain rule is applied.
 */
function differentiateUnknownApplication(
  expr: Expression & FunctionInterface,
  v: string,
  depth: number,
  trace: DerivativeTrace | undefined
): Expression | undefined {
  const ce = expr.engine;
  const opSym = ce.symbol(expr.operator);

  // The `derivative` key of the definition, when there is one, comes first:
  // it is what the author of the operator stated, and it has precedence over
  // differentiating the body of a function-literal `evaluate` handler.
  const keyed = differentiateWithDerivativeKey(expr, opSym, v, depth, trace);
  if (keyed !== undefined) return keyed;

  // Try resolving user-defined function calls before falling back to
  // symbolic chain rule: the body of the function with the arguments in
  // place of its parameters (`userFunctionBody()`) is differentiated.
  if (isUserFunction(opSym) && !isRecursiveUserFunction(opSym)) {
    const bodyWithArgs = userFunctionBody(opSym, expr.ops);
    // A body that holds the call itself (`G(G, x)` with
    // `G := (p, a) ↦ p(p, a)`) would be expanded again without end, and the
    // chain rule below has no meaning for a function given itself as an
    // argument: the derivative stays unevaluated.
    if (bodyWithArgs !== undefined && containsSame(bodyWithArgs, expr))
      return undefined;
    if (bodyWithArgs !== undefined) {
      recordD(trace, expr, v, 'derivative.expand-definition', () =>
        dPlaceholder(bodyWithArgs, v)
      );
      return differentiate(bodyWithArgs, v, depth + 1, trace);
    }
  }

  // A LAZY operator (`Integrate`, `Loop`, …) holds its
  // operands unevaluated: its slots are binders, conditions or statements,
  // not scalar function arguments, so the slot-wise chain rule below is
  // meaningless for it (it would differentiate with respect to a boolean
  // condition or a bound index). Decline instead — the enclosing `D`
  // stays inert and symbolic.
  if (opSym.operatorDefinition?.lazy) return undefined;

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

/**
 * The derivative of `expr`, an application `F(g₁, …, gₙ)`, from the
 * `derivative` key of the definition of `F` (see `OperatorDerivative` in
 * `types-definitions.ts`), by the chain rule:
 *
 *   d/dv F(g₁, …, gₙ) = Σᵢ ∂ᵢF(g₁, …, gₙ) · gᵢ′
 *
 * A partial derivative is requested only for an argument that depends on
 * `v`. A partial derivative that the key does not give (the handler returns
 * `undefined`, an array entry is not a usable function literal, or the key
 * is an array with a number of entries other than the number of arguments)
 * stays symbolic, as `Apply(Derivative(F, 0, …, 1, …, 0), g₁, …, gₙ)`. The
 * body of a function-literal `evaluate` handler is never used in place of
 * the key: the key has precedence over it, also when the key cannot be used.
 *
 * Returns `undefined` when the definition has no `derivative` key, or the
 * application has no arguments. The caller then continues with its other
 * rules.
 */
function differentiateWithDerivativeKey(
  expr: Expression & FunctionInterface,
  opSym: Expression,
  v: string,
  depth: number,
  trace: DerivativeTrace | undefined
): Expression | undefined {
  const key = opSym.operatorDefinition?.derivative;
  if (key === undefined) return undefined;
  const args = expr.ops;
  if (args.length === 0) return undefined;
  // An array is used only for an application with as many arguments as the
  // array has entries. For any other application, each partial derivative
  // stays symbolic.
  const usableArray = typeof key !== 'function' && key.length === args.length;

  const ce = expr.engine;

  // The partial derivative with respect to argument `i`, at `args`.
  const partial = (i: number): Expression => {
    const value =
      typeof key === 'function'
        ? key(args, { engine: ce, argument: i })
        : usableArray
          ? partialFromFunctionLiteral(ce, key[i], args)
          : undefined;
    // A handler may build its result in a non-canonical form, which the
    // product below cannot take.
    if (value !== undefined) return value.canonical;
    const orders = args.map((_, j) => ce.number(j === i ? 1 : 0));
    return ce._fn('Apply', [ce._fn('Derivative', [opSym, ...orders]), ...args]);
  };

  const partials: (Expression | undefined)[] = args.map((arg, i) =>
    dependsOnVariable(arg, v) ? partial(i) : undefined
  );

  recordD(trace, expr, v, 'derivative.chain-rule', () => {
    const templateTerms: Expression[] = [];
    args.forEach((arg, i) => {
      const p = partials[i];
      if (p === undefined) return;
      templateTerms.push(ce.function('Multiply', [p, dPlaceholder(arg, v)]));
    });
    if (templateTerms.length === 0) return ce.Zero;
    if (templateTerms.length === 1) return templateTerms[0];
    return ce.function('Add', templateTerms);
  });

  const terms: Expression[] = [];
  for (let i = 0; i < args.length; i++) {
    const p = partials[i];
    if (p === undefined) continue;
    const arg = args[i];
    const argPrime =
      differentiate(arg, v, depth + 1, trace) ??
      ce._fn('D', [arg, ce.symbol(v)]);
    if (!argPrime.isValid) return undefined;
    if (argPrime.isSame(0)) continue;
    terms.push(p.mul(argPrime));
  }
  if (terms.length === 0) return ce.Zero;
  return simplifyDerivative(add(...terms));
}

/**
 * The body of the function literal `entry` with each parameter replaced by
 * the matching argument of `args`: the value at `args` of a partial
 * derivative given in the array form of the `derivative` key, or the body of
 * a user function at a call (`userFunctionBody()`). The body is not
 * evaluated, so an exact form such as `ln(10)` stays exact, and the assigned
 * value of a symbol of the body is not read.
 *
 * A parameter can also be the name of a function in the body: in
 * `(f, a) ↦ f(a)`, `f(a)` is a call whose operator is the parameter `f`.
 * `subs()` replaces symbols only, never the operator of a call, so such a
 * body is substituted by `substituteParameters()`: with the arguments `h`
 * and `k`, the body is `h(k)`.
 *
 * Returns `undefined` when `entry` is not a function literal with one named
 * parameter for each argument, or when its body is a block that
 * `blockValue()` cannot reduce to a single expression.
 */
function partialFromFunctionLiteral(
  ce: Expression['engine'],
  entry: ExpressionInput | Expression,
  args: ReadonlyArray<Expression>
): Expression | undefined {
  const literal = isExpression(entry) ? entry.canonical : ce.expr(entry);
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  // A rest parameter (`Spread(rest)`) binds a tuple of the remaining
  // arguments, not one argument: such a literal is not expanded here.
  if (params.some((p) => isFunction(p, 'Spread'))) return undefined;
  const names = params.map((p) =>
    isDestructuringParameter(p) ? '' : functionLiteralParameterName(p)
  );
  if (names.some((n) => !n)) return undefined;
  let body = literal.ops[0];
  // The canonical form of a function literal wraps its body in a scoped
  // `Block`. A block with a single statement has the value of that
  // statement; a block that assigns local variables first has the value of
  // its last statement with those values substituted.
  if (isFunction(body, 'Block')) {
    const value = blockValue(ce, body);
    if (value === undefined) return undefined;
    body = value;
  }
  // A declared result type wraps the value in `Typed(value, type)`, which
  // has no derivative rule: the value is used.
  if (isFunction(body, 'Typed')) body = body.op1;
  // `subs()` is not capture-avoiding: an argument with a free symbol that
  // has the name of a variable bound inside the body (the index `k` of a
  // `Sum` in the body, with the argument `2k`) would be captured by that
  // binder. Rename each such bound variable to a fresh name first.
  body = renameCapturingBinders(ce, body, args);
  const map: Record<string, Expression> = Object.create(null);
  names.forEach((n, i) => {
    map[n] = args[i];
  });
  return substituteParameters(ce, body, map);
}

/**
 * `body` with each parameter named in `map` replaced by its argument.
 *
 * When no call in `body` has a parameter as its operator, this is
 * `body.subs(map)`. Otherwise, the body is walked once:
 * - a parameter symbol is replaced by its argument, and the argument is not
 *   walked: a call in an argument whose operator has the name of a
 *   parameter (`f(x)` in `G(h, f(x))`, with `G := (f, a) ↦ f(a)`) is not
 *   the parameter;
 * - a call whose operator is a parameter is rebuilt from its replaced
 *   operands: `f(a)` with the argument `h` for `f` is `h(k)`, and with a
 *   function literal or any other expression `ℓ` for `f` it is
 *   `Apply(ℓ, k)`. The call never keeps the name of the parameter, which
 *   could name an unrelated function outside the literal.
 * - any other node is rebuilt with its replaced operands and its own scope,
 *   as `subs()` does, so that an index of a `Sum` in the body stays bound
 *   to it. A node that is not canonical (a held operand, such as the index
 *   of `Limits`) is substituted by `subs()`.
 */
function substituteParameters(
  ce: Expression['engine'],
  body: Expression,
  map: Record<string, Expression>
): Expression {
  const isParameter = (name: string) => Object.hasOwn(map, name);
  const hasParameterCall = (e: Expression): boolean =>
    isFunction(e) &&
    (isParameter(e.operator) || e.ops.some((x) => hasParameterCall(x)));
  if (!hasParameterCall(body)) return body.subs(map);

  const walk = (e: Expression): Expression => {
    if (isSymbol(e)) return isParameter(e.symbol) ? map[e.symbol] : e;
    if (!isFunction(e)) return e;
    if (!e.isCanonical) return e.subs(map, { canonical: false });
    const ops = e.ops.map(walk);
    if (isParameter(e.operator)) {
      const fn = map[e.operator];
      return isSymbol(fn)
        ? ce.function(fn.symbol, ops)
        : ce.function('Apply', [fn, ...ops]);
    }
    if (ops.every((x, i) => x === e.ops[i])) return e;
    return ce.function(e.operator, ops, { scope: e.localScope });
  };
  return walk(body);
}

/** The statements that make a block more than a sequence of local
 * assignments followed by a value: control flow and assignments. */
const BLOCK_EFFECT_OPERATORS = [
  'Assign',
  'Declare',
  'Return',
  'Break',
  'Continue',
];

/**
 * The value of `block` as one expression: its last statement, with each
 * local variable replaced by the value the statements before it assign.
 * `Block(Declare(k), Assign(k, 2), k·x)` has the value `2x`.
 *
 * Returns `undefined` when the block is not a plain sequence of local
 * declarations and assignments followed by an expression:
 * - a statement other than `Declare(k)` (with no type and no initial value)
 *   or `Assign(k, value)` before the last one, or an assignment to a name
 *   the block does not declare (it changes a variable outside the block);
 * - a declaration of the differentiation variable `v` (it would shadow it);
 * - a local name that is still in an expression after the substitution: a
 *   local read before it is assigned, a name read before it is declared,
 *   or a local function called by name (`subs()` replaces symbols, not the
 *   name of a called function);
 * - an assigned value that is not pure (`Random()`): substituting it into
 *   each use would evaluate it more than once;
 * - control flow or an assignment inside a value or the last statement;
 * - a binder (the index of a `Sum`, the parameter of a function literal)
 *   with the name of a local, which a substitution by name cannot handle.
 */
function blockValue(
  ce: Expression['engine'],
  block: Expression,
  v?: string
): Expression | undefined {
  if (!isFunction(block, 'Block') || block.nops === 0) return undefined;
  if (block.nops === 1) return block.op1;
  const locals = new Set<string>();
  // No prototype: a local named `toString` must not find an inherited value.
  const values: Record<string, Expression> = Object.create(null);
  const substitute = (e: Expression): Expression | undefined => {
    if (e.has(BLOCK_EFFECT_OPERATORS)) return undefined;
    for (const name of collectBinderNames(e))
      if (locals.has(name)) return undefined;
    const assigned = Object.values(values);
    let result = e;
    if (assigned.length > 0) {
      result = renameCapturingBinders(ce, result, assigned);
      result = result.subs(values);
    }
    // The values hold no local name, so a local name that is left was not
    // substituted: the block cannot be reduced to one expression.
    for (const name of locals) if (result.has(name)) return undefined;
    return result;
  };
  const statements = block.ops;
  for (const statement of statements.slice(0, -1)) {
    if (isFunction(statement, 'Declare') && statement.nops === 1) {
      const name = sym(statement.op1);
      if (!name || name === v || locals.has(name)) return undefined;
      locals.add(name);
      continue;
    }
    if (isFunction(statement, 'Assign') && statement.nops === 2) {
      const name = sym(statement.op1);
      if (!name || !locals.has(name)) return undefined;
      const value = substitute(statement.op2);
      if (value === undefined || value.isPure === false) return undefined;
      values[name] = value;
      continue;
    }
    return undefined;
  }
  return substitute(statements[statements.length - 1]);
}

/**
 * `body` with every variable bound inside it whose name occurs as a symbol
 * in one of `args` renamed to a fresh name, so that substituting `args` into
 * `body` does not capture a symbol of an argument.
 *
 * Only the BOUND occurrences are renamed (the binding site and the uses that
 * the binder shadows): a free occurrence of the same name keeps its meaning.
 * The renamed expression is boxed again from its MathJSON form, so that each
 * binder gets a scope that binds the new name.
 */
function renameCapturingBinders(
  ce: Expression['engine'],
  body: Expression,
  args: ReadonlyArray<Expression>
): Expression {
  const binders = collectBinderNames(body);
  if (binders.size === 0) return body;
  const argSymbols = new Set<string>();
  for (const arg of args) for (const s of arg.symbols) argSymbols.add(s);
  const captured = [...binders].filter((n) => argSymbols.has(n));
  if (captured.length === 0) return body;

  const used = new Set<string>([...binders, ...argSymbols, ...body.symbols]);
  const fresh: Record<string, string> = {};
  for (const name of captured) {
    let i = 1;
    while (used.has(`${name}_${i}`)) i += 1;
    fresh[name] = `${name}_${i}`;
    used.add(fresh[name]);
  }
  const renamed = rewriteWithBinders(body, (s, shadowed) =>
    fresh[s.symbol] !== undefined && shadowed?.has(s.symbol)
      ? ce.symbol(fresh[s.symbol])
      : s
  );
  if (renamed === body) return body;
  return ce.box(renamed.json);
}

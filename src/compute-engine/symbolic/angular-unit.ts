import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { reduceTransformerHead } from '../boxed-expression/utils.js';

/**
 * Operators whose argument is an angle, interpreted in the engine's
 * `angularUnit` by `evaluate()`/`.N()`. Compiled code (`Math.sin`, GLSL
 * `sin`, `_IA.sin`, …) is always radian-based, so the argument must be
 * scaled at the compile boundary.
 *
 * Hyperbolic functions are deliberately absent: they take a dimensionless
 * argument, not an angle, and are unit-independent (matching `evalTrig`).
 */
export const DIRECT_TRIG_OPERATORS = new Set([
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  // Evaluates as ½(1−cos z): its argument is an angle.
  'Haversine',
]);

/**
 * Operators whose *result* is an angle, converted from radians to the
 * engine's `angularUnit` by `evaluate()`/`.N()` (see `radiansToAngle`).
 * The compiled radian-based result must be scaled back the same way.
 *
 * Inverse hyperbolic functions (`Arsinh`, `Arcosh`, …) are deliberately
 * absent: their result is an area, not an angle.
 */
export const INVERSE_TRIG_OPERATORS = new Set([
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arctan2',
  'Arccot',
  'Arcsec',
  'Arccsc',
  // Evaluates as 2·arcsin(√z): its result is an angle. Result scaling is
  // linear, so the factor of 2 composes with the unit conversion.
  'InverseHaversine',
  // The phase angle of a complex number is in the engine's unit, as the
  // result of `Arctan2` is. Every target lowers it to a radian value
  // (`Math.atan2`, `_IA.atan2`, `atan`, `np.angle`, or `0`/`π` for a real
  // operand), so the compiled result is scaled the same way.
  'Argument',
]);

/**
 * The derivative heads whose operands are NOT rewritten by
 * `rewriteAngularUnit`.
 *
 * Differentiation is unit-aware (`symbolic/derivative.ts` multiplies the
 * radian formula by `angularChainFactor`), so it must run on the tree in the
 * engine's own angular convention. The rewritten (radian-convention) tree
 * would pick up the chain factor a second time. The closed form these heads
 * lower to is rewritten instead, at the point it is produced
 * (`compileDerivative` in `library/calculus.ts`).
 */
const DERIVATIVE_HEADS = new Set(['D', 'Derivative', 'ND']);

/**
 * Does `expr` contain a derivative head anywhere — i.e. a subtree that
 * {@link rewriteAngularUnit} deliberately left in the ENGINE's angular
 * convention while rewriting everything around it into radians?
 *
 * A caller that wants to evaluate a rewritten tree has to know this: after
 * the rewrite, a tree with no derivative head is uniformly radian-convention
 * and must be evaluated as such, while one that HAS a derivative head carries
 * two conventions at once and can be evaluated correctly under neither single
 * setting. The compile-time constant folder uses this to neutralize the
 * angular unit in the first case and to decline outright in the second
 * (`tryConstantFold`, `compilation/base-compiler.ts`).
 *
 * Kept next to {@link DERIVATIVE_HEADS} on purpose: a head added to the
 * rewrite's skip list must also become a decline for anyone evaluating the
 * rewritten tree, and separating the two would let them drift silently.
 */
export function containsDerivativeHead(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (DERIVATIVE_HEADS.has(expr.operator)) return true;
  return expr.ops.some(containsDerivativeHead);
}

/**
 * The chain factor dθ/da converting the engine's angular unit to radians, as
 * an EXACT expression (`π/180` in degree mode, `1` in radian mode) — matching
 * `angleToRadians` in `boxed-expression/utils.ts`.
 *
 * `Sin`/`Cos`/… interpret their argument in `ce.angularUnit`, so a symbolic
 * derivative taken in the same convention carries this factor.
 */
export function angularChainFactor(ce: Expression['engine']): Expression {
  switch (ce.angularUnit) {
    case 'deg':
      return ce.function('Divide', [ce.Pi, ce.number(180)]);
    case 'grad':
      return ce.function('Divide', [ce.Pi, ce.number(200)]);
    case 'turn':
      return ce.function('Multiply', [ce.number(2), ce.Pi]);
    default:
      return ce.One; // 'rad'
  }
}

/**
 * Rewrite an expression so that compiling it with radian-based math
 * libraries reproduces the engine's `angularUnit` semantics:
 *
 * - direct trig arguments are scaled by the unit→radian factor
 *   (`Sin(u)` → `Sin(k·u)` with `k = π/180` in degree mode), and
 * - inverse trig results are scaled by the radian→unit factor
 *   (`Arcsin(u)` → `(1/k)·Arcsin(u)`), and
 * - `Degrees(u)` is replaced by its value in the engine unit (`u`, `10u/9`
 *   or `u/360`), because the targets lower `Degrees` to a radian value.
 *
 * A no-op when `angularUnit` is `"rad"`. Every compilation target applies
 * this rewrite at its public `compile()` entry so compiled output agrees
 * with `evaluate()` — the requirement reported by the Tycho integration
 * (degree-mode documents previously *evaluated* in degrees but *plotted*
 * in radians).
 *
 * The scale factors are float literals (not exact `π/180` expressions): the
 * rewritten tree is only ever fed to codegen, which numericizes anyway, and
 * float factors keep the emitted GLSL/WGSL/JS free of symbolic constants.
 *
 * With `options.exactFactors`, the factors are EXACT expressions instead:
 * `π/180` (`angularChainFactor`), its reciprocal for the inverse heads, and
 * the rationals `10/9` and `1/360` for `Degrees`. A target that computes
 * with enclosures (`interval-js`) needs them: it lowers `Pi` and a rational
 * that no double holds to an enclosure of the exact value, and the product
 * by the factor to an interval product, so the scaled angle contains the
 * true angle. A float factor is the double NEAREST to the factor, which can
 * be on either side of it: `2 * Math.PI` is below 2π, so in `turn` mode the
 * compiled `Cos` of the point `0.25` was strictly positive and excluded the
 * true value 0.
 *
 * Lives in `symbolic/` rather than `compilation/` only so the derivative
 * lowering (`library/calculus.ts`) can reach it: `library/` must not import
 * from `compilation/`. `compilation/angular-unit.ts` re-exports it for the
 * targets.
 */
export function rewriteAngularUnit(
  expr: Expression,
  options?: { exactFactors?: boolean }
): Expression {
  const ce = expr.engine;
  const unit = ce.angularUnit;
  if (unit === 'rad') return expr;
  const exact = options?.exactFactors === true;

  const toRad =
    unit === 'deg'
      ? Math.PI / 180
      : unit === 'grad'
        ? Math.PI / 200
        : 2 * Math.PI; // 'turn'
  // The unit-to-radian factor `k` and the radian-to-unit factor `1/k`.
  const toRadFactor = exact ? angularChainFactor(ce) : ce.number(toRad);
  const fromRadFactor = exact
    ? ce.function('Divide', [ce.One, toRadFactor])
    : ce.number(1 / toRad);

  const walk = (e: Expression): Expression => {
    if (!isFunction(e)) return e;

    // A derivative head differentiates in the engine's angular convention —
    // see `DERIVATIVE_HEADS`.
    if (DERIVATIVE_HEADS.has(e.operator)) return e;

    let changed = false;
    const ops = e.ops.map((op) => {
      const t = walk(op);
      if (t !== op) changed = true;
      return t;
    });

    const h = e.operator;
    // `Degrees(u)` is an angle in the engine's unit (`evaluate()` gives `u`
    // in degree mode, `10u/9` in grad mode, `u/360` in turn mode). The target
    // lowerings of `Degrees` convert to RADIANS, which is correct only in
    // radian mode, where this rewrite does not run. Replace the node here
    // with the conversion to the engine unit, so that an enclosing trig
    // call then scales it to radians like any other angle.
    if (h === 'Degrees' && ops.length === 1) {
      if (unit === 'deg') return ops[0];
      const ratio = unit === 'grad' ? ([10, 9] as const) : ([1, 360] as const);
      return ce.function('Multiply', [
        exact
          ? ce.number([ratio[0], ratio[1]])
          : ce.number(ratio[0] / ratio[1]),
        ops[0],
      ]);
    }
    if (DIRECT_TRIG_OPERATORS.has(h) && ops.length === 1) {
      return ce.function(h, [ce.function('Multiply', [toRadFactor, ops[0]])]);
    }
    if (INVERSE_TRIG_OPERATORS.has(h) && ops.length >= 1) {
      const call = changed ? ce.function(h, ops) : e;
      return ce.function('Multiply', [fromRadFactor, call]);
    }
    return changed ? ce.function(h, ops) : e;
  };

  return walk(expr);
}

/**
 * Rewrite an expression from the engine's angular convention to the RADIAN
 * convention, with EXACT factors: a direct trigonometric call `Sin(u)`
 * becomes `Sin(k·u)` and an inverse one `Arcsin(u)` becomes `Arcsin(u)/k`,
 * where `k` is the chain factor of `angularChainFactor` (`π/180` in degree
 * mode); `Degrees(u)` becomes its value in the engine's unit. The result
 * denotes the same function of its free symbols, read in radians. A no-op
 * in radian mode.
 *
 * The symbolic integrator uses it: its table and rules hold the radian
 * antiderivatives, so in another unit it integrates the rewritten integrand
 * with the engine switched to radians and maps the result back with
 * `fromRadianConvention`. Unlike `rewriteAngularUnit`, which prepares a
 * tree for code generation with float factors, this rewrite keeps the
 * factors exact so that an exact integrand gives an exact antiderivative,
 * and it enters derivative heads, whose operands are then differentiated in
 * radians along with the rest.
 */
export function toRadianConvention(expr: Expression): Expression {
  const ce = expr.engine;
  const unit = ce.angularUnit;
  if (unit === 'rad') return expr;
  const k = angularChainFactor(ce);
  const walk = (e: Expression): Expression => {
    if (!isFunction(e)) return e;
    let changed = false;
    const ops = e.ops.map((op) => {
      const t = walk(op);
      if (t !== op) changed = true;
      return t;
    });
    const h = e.operator;
    // `Degrees(u)` is an angle of `u` degrees in the engine's unit, and so
    // is `DMS(d, m, s)` with `u = d + m/60 + s/3600` (its canonical form is
    // `Degrees` when its components are literals).
    const degrees =
      h === 'Degrees' && ops.length === 1
        ? ops[0]
        : h === 'DMS' && ops.length >= 1 && ops.length <= 3
          ? ce.function('Add', [
              ops[0],
              ce.function('Divide', [ops[1] ?? ce.Zero, ce.number(60)]),
              ce.function('Divide', [ops[2] ?? ce.Zero, ce.number(3600)]),
            ])
          : undefined;
    if (degrees !== undefined) {
      if (unit === 'deg') return degrees;
      return ce.function('Multiply', [
        unit === 'grad' ? ce.number([10, 9]) : ce.number([1, 360]),
        degrees,
      ]);
    }
    if (DIRECT_TRIG_OPERATORS.has(h) && ops.length === 1) {
      // The factor is distributed over a sum (`k·x + 90k`, not
      // `k·(x + 90)`): the integrator's rules read a linear argument as
      // `a·x + b` and leave the factored form unevaluated.
      const u = ops[0];
      const scaled = isFunction(u, 'Add')
        ? ce.function(
            'Add',
            u.ops.map((term) => ce.function('Multiply', [k, term]))
          )
        : ce.function('Multiply', [k, u]);
      return ce.function(h, [scaled]);
    }
    if (INVERSE_TRIG_OPERATORS.has(h) && ops.length >= 1)
      return ce.function('Divide', [changed ? ce.function(h, ops) : e, k]);
    return changed ? ce.function(h, ops) : e;
  };
  return walk(expr);
}

/**
 * The inverse of `toRadianConvention`: rewrite an expression written in the
 * radian convention so that it denotes the same function when read in the
 * engine's angular unit. A direct trigonometric call `Sin(w)` becomes
 * `Sin(w/k)`, with the chain factor cancelled from the argument
 * (`Sin((π/180)·x)` becomes `Sin(x)`), and an inverse one `Arctan(u)`
 * becomes `k·Arctan(u)`. A no-op in radian mode.
 */
export function fromRadianConvention(expr: Expression): Expression {
  const ce = expr.engine;
  if (ce.angularUnit === 'rad') return expr;
  const k = angularChainFactor(ce);
  const walk = (e: Expression): Expression => {
    if (!isFunction(e)) return e;
    let changed = false;
    const ops = e.ops.map((op) => {
      const t = walk(op);
      if (t !== op) changed = true;
      return t;
    });
    const h = e.operator;
    if (DIRECT_TRIG_OPERATORS.has(h) && ops.length === 1) {
      // `.div()` cancels the factor from a product (`(π/180)·x` gives `x`)
      // but not from a sum, so each term of a sum is divided on its own.
      const w = ops[0];
      const argument = isFunction(w, 'Add')
        ? ce.function(
            'Add',
            w.ops.map((term) => term.div(k))
          )
        : w.div(k);
      return ce.function(h, [argument]);
    }
    if (INVERSE_TRIG_OPERATORS.has(h) && ops.length >= 1)
      return ce.function('Multiply', [k, changed ? ce.function(h, ops) : e]);
    return changed ? ce.function(h, ops) : e;
  };
  return walk(expr);
}

/** The heads whose meaning depends on the engine's angular unit. */
const UNIT_DEPENDENT_HEADS: ReadonlySet<string> = new Set([
  ...DIRECT_TRIG_OPERATORS,
  ...INVERSE_TRIG_OPERATORS,
  'Degrees',
  'DMS',
]);

/**
 * Replace each symbol whose value contains a unit-dependent head
 * (`a := Sin(30)`) by that value, so that `toRadianConvention` sees and
 * scales the trigonometric call: read through the symbol in radian mode,
 * the value would be computed in radians. Every other symbol is kept, so
 * the antiderivative still names it. The index is never a value.
 */
function resolveUnitDependentValues(
  expr: Expression,
  index: string,
  seen: Set<string> = new Set()
): Expression {
  const ce = expr.engine;
  if (isSymbol(expr)) {
    const name = expr.symbol;
    if (name === index || seen.has(name)) return expr;
    const value = expr.value;
    if (
      value === undefined ||
      !isFunction(value) ||
      !value.has([...UNIT_DEPENDENT_HEADS])
    )
      return expr;
    seen.add(name);
    const resolved = resolveUnitDependentValues(value, index, seen);
    seen.delete(name);
    return resolved;
  }
  if (!isFunction(expr)) return expr;
  const ops = expr.ops.map((op) => resolveUnitDependentValues(op, index, seen));
  if (ops.every((op, i) => op === expr.ops[i])) return expr;
  return ce.function(expr.operator, ops);
}

/**
 * Run an integration step in the RADIAN convention: `integrand` is
 * rewritten with `toRadianConvention` (after the symbols whose value
 * depends on the unit are resolved and the user functions it applies are
 * inlined, so that every unit-dependent node is visible to the rewrite),
 * `fn` runs on the rewritten integrand with the engine switched to radians
 * (`_withTransientAngularUnit`, restored on every exit), and its result is
 * mapped back to the engine's unit with `fromRadianConvention`. In radian
 * mode `fn` runs on `integrand` as it is.
 *
 * The symbolic integrator and the integration provider (the Rubi rules)
 * both hold radian antiderivatives, so both go through here.
 */
export function withRadianConvention<R extends Expression | null>(
  integrand: Expression,
  index: string,
  fn: (radianIntegrand: Expression) => R
): R {
  const ce = integrand.engine;
  if (ce.angularUnit === 'rad') return fn(integrand);
  const visible = reduceTransformerHead(
    resolveUnitDependentValues(integrand, index)
  );
  const radian = toRadianConvention(visible);
  const result = ce._withTransientAngularUnit('rad', () => fn(radian));
  return (result === null ? null : fromRadianConvention(result)) as R;
}

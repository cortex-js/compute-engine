import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';

/**
 * Operators whose argument is an angle, interpreted in the engine's
 * `angularUnit` by `evaluate()`/`.N()`. Compiled code (`Math.sin`, GLSL
 * `sin`, `_IA.sin`, …) is always radian-based, so the argument must be
 * scaled at the compile boundary.
 *
 * Hyperbolic functions are deliberately absent: they take a dimensionless
 * argument, not an angle, and are unit-independent (matching `evalTrig`).
 */
const DIRECT_TRIG_OPERATORS = new Set([
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
const INVERSE_TRIG_OPERATORS = new Set([
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
]);

/**
 * Rewrite an expression so that compiling it with radian-based math
 * libraries reproduces the engine's `angularUnit` semantics:
 *
 * - direct trig arguments are scaled by the unit→radian factor
 *   (`Sin(u)` → `Sin(k·u)` with `k = π/180` in degree mode), and
 * - inverse trig results are scaled by the radian→unit factor
 *   (`Arcsin(u)` → `(1/k)·Arcsin(u)`).
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
 */
export function rewriteAngularUnit(expr: Expression): Expression {
  const ce = expr.engine;
  const unit = ce.angularUnit;
  if (unit === 'rad') return expr;

  const toRad =
    unit === 'deg'
      ? Math.PI / 180
      : unit === 'grad'
        ? Math.PI / 200
        : 2 * Math.PI; // 'turn'

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
      return ce.function(h, [
        ce.function('Multiply', [ce.number(toRad), ops[0]]),
      ]);
    }
    if (INVERSE_TRIG_OPERATORS.has(h) && ops.length >= 1) {
      const call = changed ? ce.function(h, ops) : e;
      return ce.function('Multiply', [ce.number(1 / toRad), call]);
    }
    return changed ? ce.function(h, ops) : e;
  };

  return walk(expr);
}

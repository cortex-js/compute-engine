import {
  SIGNED_INFINITY_TYPE,
  EXTENDED_REAL_TYPE,
} from '../../common/type/primitive.js';
import type {
  SymbolDefinitions,
  Expression,
  IComputeEngine,
} from '../global-types.js';
import { applyN, shouldNumericize } from '../boxed-expression/apply.js';
import {
  asSmallInteger,
  provablyNonFiniteNumber,
} from '../boxed-expression/numerics.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import { infinitePoint } from '../boxed-expression/infinite-point.js';
import {
  numericTypeHandler,
  boundedInverseTrigType,
  iv,
  type RealDomain,
  operandLiteralValue,
} from './type-handlers.js';
// The `'types'`-shape twins of the helpers above, wired to the definitions
// that declare `typeHandlerKind: 'types'`. Both modules export the same
// names on purpose (a converted call site otherwise changes only its import
// path), so the twins carry an `OnTypes` suffix here to keep the two shapes
// readable side by side while the migration runs.
import {
  broadcastOperandType,
  numericTypeHandler as numericTypeHandlerOnTypes,
} from './type-handlers-types.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import { signOfType } from '../../common/type/utils.js';
import { nonNegativeSign } from '../boxed-expression/sgn.js';
import {
  ellipticK,
  ellipticE,
  bigEllipticK,
  bigEllipticE,
  ellipticF,
  ellipticEIncomplete,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  bigHypergeometric2F1,
  bigHypergeometric1F1,
  appellF1,
  agm,
  bigAgm,
  expIntegralEi,
  logIntegral,
  polylog,
} from '../numerics/special-functions.js';
import {
  ellipticKComplex,
  ellipticEComplex,
  ellipticFComplex,
  ellipticEIncompleteComplex,
  ellipticPiCompleteComplex,
  ellipticPiIncompleteComplex,
  hypergeometric2F1Complex,
  hypergeometric1F1Complex,
  appellF1Complex,
  jacobiTheta,
  dedekindEta,
  eisensteinE,
  agmComplex,
  polylogComplex,
  expIntegralEiComplex,
} from '../numerics/numeric-complex.js';

/**
 * Tier-2 numeric kernels for special functions (ROADMAP item 4).
 *
 * These heads appear throughout the Fungrim corpus (and the Rubi rule set)
 * as "shells": symbolic identities reference them, but until now they had
 * no numeric `evaluate`. Conventions match the Fungrim corpus
 * (`data/fungrim/declarations.json`):
 *
 * - `EllipticK(m)` / `EllipticE(m)` use the *parameter* m = k²
 *   (K(m) = ∫₀^{π/2} dθ/√(1 − m·sin²θ), Fungrim e8ae42/723fd0).
 * - `JacobiTheta(j, z, tau)` uses nome q = e^{iπτ} and period 1 in z
 *   (Fungrim f96eac). The optional 4ᵗʰ argument (derivative order r) is
 *   only evaluated for r = 0.
 * - `DedekindEta(tau)` = e^{iπτ/12}·∏(1 − e^{2πikτ}) (Fungrim 1dc520).
 */

/** `EllipticK`: real for m < 1, `+∞` pole at m = 1, finite complex for m > 1. */
const ELLIPTIC_K_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, 1, false)],
  complex: [iv(1, false, Infinity, false)],
  poles: [1],
  poleType: SIGNED_INFINITY_TYPE,
};

/** Complete `EllipticE`: real for m ≤ 1 (E(1) = 1), finite complex for m > 1. */
const ELLIPTIC_E_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, 1, true)],
  complex: [iv(1, false, Infinity, false)],
  poles: [],
  poleType: 'number',
};

/**
 * What a head whose limits at infinity depend on its other parameters does
 * when an operand is infinite (`Hypergeometric2F1`, `Hypergeometric1F1`,
 * `AppellF1`, `PolyLog`, the incomplete elliptic integrals and
 * `JacobiTheta`; ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8):
 * the operand is IN the carrier
 * (`complex | infinity`), but the value there goes through connection
 * formulas the engine does not implement — `₂F₁(1, 1; 2; z) → 0` as
 * `z → ∞` while `₂F₁(−1, 1; 2; z)` diverges — so the application stays
 * SYMBOLIC on both routes, the same class as `Zeta(3)` (a value with no
 * closed form here). An anonymous infinity (`∞ + i`) is `NaN`, as for
 * every special-function head.
 *
 * Returns `ce.NaN` for an anonymous infinity, `null` when the application
 * must stay symbolic, and `undefined` when every operand is finite (or not
 * a number literal) and the handler may go on.
 */
function symbolicAtInfinity(
  ops: ReadonlyArray<Expression>,
  ce: IComputeEngine
): Expression | null | undefined {
  let infinite = false;
  for (const op of ops) {
    const point = infinitePoint(op);
    if (point === 'anonymous') return ce.NaN;
    if (point !== undefined) infinite = true;
  }
  return infinite ? null : undefined;
}

/**
 * The value of `AGM(a, b)` when at least one operand is infinite, or
 * `undefined` when both are finite (ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8;
 * each limit verified numerically at 10², 10⁴, 10⁶):
 *
 * - `AGM(a, +∞) = +∞` for a finite positive real a (AGM(1, 10⁶) =
 *   1.03·10⁵, growing like `πb/(2 ln b)`).
 * - `AGM(a, ~∞) = ~∞` for any finite non-zero a: the modulus grows without
 *   bound in every direction (the modulus rule).
 * - `AGM(a, −∞)`, and `AGM(a, +∞)` for a non-real or negative a, tend to
 *   an infinite value in a non-real direction (AGM(1, −10⁶) = −9.9·10⁴ +
 *   2.0·10⁴i), which the engine spells `~∞` (`i·∞` boxes to `~∞`).
 * - `AGM(0, ∞) = 0`: zero is an annihilator of the AGM (`AGM(0, b) = 0`
 *   identically, since the geometric mean is 0 from the first step), so
 *   the value is 0 whatever the other operand does.
 * - Two infinite operands, and an anonymous infinity: `NaN`.
 *
 * A non-literal partner (a symbol) leaves the application symbolic.
 */
function agmValueAtInfinity(
  a: Expression,
  b: Expression,
  ce: IComputeEngine
): Expression | undefined {
  const pa = infinitePoint(a);
  const pb = infinitePoint(b);
  if (pa === undefined && pb === undefined) return undefined;
  if (pa === 'anonymous' || pb === 'anonymous') return ce.NaN;
  if (pa !== undefined && pb !== undefined) return ce.NaN;
  const [point, partner] = pa !== undefined ? [pa, b] : [pb, a];
  if (!isNumber(partner)) return undefined;
  if (partner.isSame(0)) return ce.Zero;
  if (point === '~oo') return ce.ComplexInfinity;
  if (point === '+oo' && partner.im === 0 && partner.isPositive === true)
    return ce.PositiveInfinity;
  return ce.ComplexInfinity;
}

export const SPECIAL_FUNCTIONS_LIBRARY: SymbolDefinitions[] = [
  {
    EllipticK: {
      description:
        'Complete elliptic integral of the first kind K(m), parameter convention m = k².',
      wikidata: 'Q1080993',
      complexity: 8600,
      broadcastable: true,
      // The carrier is every number except NaN: K has a value at every
      // finite complex point (the pole `+∞` at m = 1 — from the right the
      // real part diverges while the imaginary part stays at −π/2, the
      // `Ln(0) = −∞` convention), and at every infinity the value is 0:
      // `K(m) ≈ ln(4√−m)/√−m → 0` in every direction (K(10⁶) = 0.0016 −
      // 0.008i, K(−10⁶) = 0.008), so `±∞` and `~oo` all answer 0 (ruling
      // recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
      // Phase F batch 8); an anonymous infinity (`∞ + i`) is `NaN`. `NaN`
      // propagates (explicit: the carrier is not a subtype of `complex`).
      // No `canonical` handler, so a proven off-carrier operand is
      // rejected at boxing.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // Real for m < 1, the +∞ pole at m = 1 (mirroring the `evaluate`
      // special case below), and a finite complex value for m > 1
      // (`K(2) = 1.311… − 1.311…i`).
      type: (ops) => boundedInverseTrigType(ops, ELLIPTIC_K_DOMAIN),
      evaluate: ([m], { numericApproximation, engine }) => {
        // K(1) = +∞ exactly (Fungrim 45b157)
        if (isNumber(m) && m.im === 0 && m.isSame(1))
          return engine.PositiveInfinity;
        const point = infinitePoint(m);
        if (point === 'anonymous') return engine.NaN;
        if (point !== undefined) return engine.Zero;
        return shouldNumericize(numericApproximation, m)
          ? applyN(
              [m],
              ellipticK,
              (m) => bigEllipticK(engine, m),
              ellipticKComplex
            )
          : undefined;
      },
    },

    EllipticE: {
      description:
        'Elliptic integral of the second kind: complete E(m) with one ' +
        'argument, incomplete E(φ|m) with two (amplitude first, parameter ' +
        'convention m = k², as in Mathematica).',
      wikidata: 'Q1375529',
      complexity: 8600,
      broadcastable: true,
      // Both slots take the carrier `complex | infinity`; `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing. The complete form has a value at every infinity (ruling
      // recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
      // Phase F batch 8; verified numerically): `E(−∞) = +∞`
      // (E(−10⁶) = 1000.004, growing like √−m); `E(+∞)` tends to `i·∞`
      // (E(10⁶) = −0.02 + 1000.1i, the real part vanishing), an infinite
      // value in a non-real direction, which the engine spells `~oo`
      // (`i·∞` boxes to `~oo`);
      // `E(~oo) = ~oo` (the modulus grows without bound in every
      // direction); an anonymous infinity is `NaN`. The incomplete form
      // stays symbolic at an infinite operand (`symbolicAtInfinity`).
      signature: '(complex | infinity, (complex | infinity)?) -> number',
      nanBehavior: 'propagate',
      // Complete E(m): real on m ≤ 1 (E(1) = 1), finite complex for m > 1.
      // Incomplete E(φ|m): the value is complex whenever m·sin²φ > 1, a
      // condition on both operands, so the claim is the top numeric type
      // `number`, which admits real and complex alike. It is constant: the
      // non-finite operand case reaches the same `number`, so testing for
      // one changes nothing.
      type: (ops) =>
        ops.length === 1
          ? boundedInverseTrigType(ops, ELLIPTIC_E_DOMAIN)
          : 'number',
      evaluate: (ops, { numericApproximation, engine }) => {
        if (ops.length === 2) {
          // Incomplete E(φ|m): E(0|m) = 0 exactly
          const [phi, m] = ops;
          if (isNumber(phi) && phi.im === 0 && phi.isSame(0))
            return engine.Zero;
          const held = symbolicAtInfinity(ops, engine);
          if (held !== undefined) return held ?? undefined;
          return shouldNumericize(numericApproximation, phi, m)
            ? applyN(
                [phi, m],
                ellipticEIncomplete,
                undefined,
                ellipticEIncompleteComplex
              )
            : undefined;
        }
        const m = ops[0];
        // E(1) = 1 exactly
        if (isNumber(m) && m.im === 0 && m.isSame(1)) return engine.One;
        const point = infinitePoint(m);
        if (point === 'anonymous') return engine.NaN;
        if (point === '-oo') return engine.PositiveInfinity;
        if (point !== undefined) return engine.ComplexInfinity;
        return shouldNumericize(numericApproximation, m)
          ? applyN(
              [m],
              ellipticE,
              (m) => bigEllipticE(engine, m),
              ellipticEComplex
            )
          : undefined;
      },
    },

    EllipticF: {
      description:
        'Incomplete elliptic integral of the first kind F(φ|m) (amplitude ' +
        'first, parameter convention m = k², as in Mathematica). ' +
        'F(π/2|m) = K(m).',
      wikidata: 'Q1062952',
      complexity: 8600,
      broadcastable: true,
      // Both slots take the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`); `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature: '(complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // `number` is the honest top for every operand pair, so the claim is
      // constant. Two things defeat a narrower one. Incomplete F(φ|m) is
      // complex whenever m·sin²φ > 1 — a condition on both operands
      // (`F(1.5|2) = 1.311… − 1.240…i`) — so a real claim is unsound. And
      // F diverges at FINITE operands: the integrand of
      // `F(φ|m) = ∫₀^φ dθ/√(1 − m·sin²θ)` has a pole at m = 1, θ = π/2, so
      // `F(π/2|1)` is infinite. A finiteness claim is therefore unsound too,
      // even for operands that are themselves finite.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: ([phi, m], { numericApproximation, engine }) => {
        // F(0|m) = 0 exactly
        if (isNumber(phi) && phi.im === 0 && phi.isSame(0)) return engine.Zero;
        const held = symbolicAtInfinity([phi, m], engine);
        if (held !== undefined) return held ?? undefined;
        return shouldNumericize(numericApproximation, phi, m)
          ? applyN([phi, m], ellipticF, undefined, ellipticFComplex)
          : undefined;
      },
    },

    EllipticPi: {
      description:
        'Elliptic integral of the third kind: complete Π(n|m) with two ' +
        'arguments, incomplete Π(n; φ|m) with three (characteristic first, ' +
        'amplitude second, parameter convention m = k², as in Mathematica).',
      wikidata: 'Q1123360',
      complexity: 8600,
      broadcastable: true,
      // Every slot takes the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`); `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature:
        '(complex | infinity, complex | infinity, (complex | infinity)?) -> number',
      nanBehavior: 'propagate',
      // `number` is the honest top for every operand triple, so the claim is
      // constant. Π has a +∞ pole at the characteristic n = 1 (`Π(1|m)`), so
      // no finiteness claim is sound even for finite operands, and the
      // incomplete form is complex outside the real domain (a condition on
      // several operands), so no real claim is sound either.
      type: () => 'number',
      evaluate: (ops, { numericApproximation, engine }) => {
        if (ops.length === 3) {
          const [n, phi, m] = ops;
          // Π(n; 0|m) = 0 exactly
          if (isNumber(phi) && phi.im === 0 && phi.isSame(0))
            return engine.Zero;
          const held = symbolicAtInfinity(ops, engine);
          if (held !== undefined) return held ?? undefined;
          return shouldNumericize(numericApproximation, n, phi, m)
            ? applyN(
                [n, phi, m],
                ellipticPiIncomplete,
                undefined,
                ellipticPiIncompleteComplex
              )
            : undefined;
        }
        const held = symbolicAtInfinity(ops, engine);
        if (held !== undefined) return held ?? undefined;
        return shouldNumericize(numericApproximation, ...ops)
          ? applyN(
              ops,
              ellipticPiComplete,
              undefined,
              ellipticPiCompleteComplex
            )
          : undefined;
      },
    },

    AGM: {
      description:
        'Arithmetic-geometric mean. AGM(z) is shorthand for AGM(1, z) (Fungrim convention).',
      complexity: 8500,
      broadcastable: true,
      // Both slots take the carrier `complex | infinity`; the values at the
      // infinite points are `agmValueAtInfinity`'s, answered on both
      // routes; `NaN` propagates (explicit: the carrier is not a subtype
      // of `complex`); no `canonical` handler, so a proven off-carrier
      // operand is rejected at boxing.
      signature: '(complex | infinity, (complex | infinity)?) -> number',
      nanBehavior: 'propagate',
      // Real and finite for non-negative real operands; a negative operand
      // takes the complex AGM (`AGM(1, −2) = −0.4229… + 0.6612…i`).
      type: (ops) => {
        if (ops.some((x) => provablyNonFiniteNumber(x))) return 'number';
        if (
          ops.every(
            (x) => x.isExtendedReal === true && x.isNonNegative === true
          )
        )
          return 'real';
        return 'number';
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        const args = ops.length === 1 ? [engine.One, ops[0]] : [...ops];
        const infinite = agmValueAtInfinity(args[0], args[1], engine);
        if (infinite !== undefined) return infinite;
        if (!shouldNumericize(numericApproximation, ...ops)) return undefined;
        return applyN(args, agm, bigAgm, agmComplex);
      },
    },

    Hypergeometric2F1: {
      description: 'Gauss hypergeometric function ₂F₁(a, b; c; z).',
      wikidata: 'Q672619',
      complexity: 8700,
      // Every slot takes the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`); `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature:
        '(complex | infinity, complex | infinity, complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation, engine }) => {
        // ₂F₁(a, b; c; 0) = 1 exactly
        const z = ops[3];
        if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.One;
        const held = symbolicAtInfinity(ops, engine);
        if (held !== undefined) return held ?? undefined;
        return shouldNumericize(numericApproximation, ...ops)
          ? applyN(
              ops,
              hypergeometric2F1,
              (a, b, c, z) => bigHypergeometric2F1(engine, a, b, c, z),
              (a, b, c, z) => hypergeometric2F1Complex(a, b, c, z)
            )
          : undefined;
      },
    },

    AppellF1: {
      description:
        'Appell hypergeometric function F₁(a; b₁, b₂; c; x, y), double series for |x|, |y| < 1.',
      wikidata: 'Q2701540',
      complexity: 8800,
      // Every slot takes the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`); `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature:
        '(complex | infinity, complex | infinity, complex | infinity, complex | infinity, complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation, engine }) => {
        // F₁(a; b₁, b₂; c; 0, 0) = 1 exactly
        const [, , , , x, y] = ops;
        if (
          isNumber(x) &&
          x.im === 0 &&
          x.isSame(0) &&
          isNumber(y) &&
          y.im === 0 &&
          y.isSame(0)
        )
          return engine.One;
        const held = symbolicAtInfinity(ops, engine);
        if (held !== undefined) return held ?? undefined;
        return shouldNumericize(numericApproximation, ...ops)
          ? applyN(ops, appellF1, undefined, appellF1Complex)
          : undefined;
      },
    },

    PolyLog: {
      description: 'Polylogarithm Liₛ(z) = Σ_{k≥1} zᵏ/kˢ.',
      wikidata: 'Q320067',
      complexity: 8700,
      // Both slots take the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`, consulted BEFORE the
      // elementary reductions, which would otherwise turn `Li₀(+∞) =
      // ∞/(1 − ∞)` into `NaN`); `NaN` propagates (explicit: the carrier is
      // not a subtype of `complex`); no `canonical` handler, so a proven
      // off-carrier operand is rejected at boxing.
      signature: '(complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // Liₛ(1) = ζ(s) is finite for s > 1 but a pole (value `~oo`, only
      // representable by `number`) for s ≤ 1; likewise Li₀/Li₋₁ at z = 1.
      type: ([s, z]) => {
        // The order's value is read through the literal's handler-visible
        // type first (`operandLiteralValue` — the channel that survives
        // when the value reads are unavailable to a type handler), then
        // the value channel.
        const sRe =
          s === undefined ? undefined : (operandLiteralValue(s) ?? s.re);
        if (
          z?.isSame(1) === true &&
          s !== undefined &&
          isNumber(s) &&
          s.im === 0 &&
          typeof sRe === 'number' &&
          sRe <= 1
        )
          return 'number';
        return numericTypeHandler([s, z]);
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        const [s, z] = ops;
        // `Liₛ(0) = 0` for EVERY order, an infinite one included, so it is
        // decided before the infinity hold below.
        if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.Zero;
        const held = symbolicAtInfinity(ops, engine);
        if (held !== undefined) return held ?? undefined;
        // Exact reductions (see `polylogReduce`). Evaluate the reduced form so
        // an inexact argument still numericizes (exactness contract).
        const reduced = polylogReduce(engine, s, z);
        if (reduced !== undefined)
          return reduced.evaluate({ numericApproximation });

        // Numeric kernel: integer order s ≥ 2 only (dilog/trilog/Li₄ …).
        // Other orders have no kernel here → stay symbolic.
        const sInt = asSmallInteger(s);
        if (sInt === null || sInt < 2) return undefined;
        return shouldNumericize(numericApproximation, s, z)
          ? applyN([s, z], polylog, undefined, polylogComplex)
          : undefined;
      },
    },

    Hypergeometric1F1: {
      description:
        'Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z).',
      wikidata: 'Q1331447',
      complexity: 8700,
      // Every slot takes the carrier `complex | infinity`; an infinite
      // operand stays symbolic (`symbolicAtInfinity`); `NaN` propagates
      // (explicit: the carrier is not a subtype of `complex`); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature:
        '(complex | infinity, complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation, engine }) => {
        // ₁F₁(a; b; 0) = 1 exactly
        const z = ops[2];
        if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.One;
        const held = symbolicAtInfinity(ops, engine);
        if (held !== undefined) return held ?? undefined;
        return shouldNumericize(numericApproximation, ...ops)
          ? applyN(
              ops,
              hypergeometric1F1,
              (a, b, z) => bigHypergeometric1F1(engine, a, b, z),
              hypergeometric1F1Complex
            )
          : undefined;
      },
    },

    JacobiTheta: {
      description:
        'Jacobi theta function θⱼ(z, τ), j ∈ {1,2,3,4}, nome q = e^{iπτ} (Fungrim convention).',
      wikidata: 'Q1154532',
      complexity: 8800,
      // `j` is validated in the evaluate handler ('number' rather than
      // 'integer' so that rule-pattern wildcards — typed 'complex' — box).
      // The `z` and `τ` slots take the carrier `complex | infinity`; an
      // infinite operand stays symbolic (`symbolicAtInfinity`); `NaN`
      // propagates (explicit: those carriers are not subtypes of
      // `complex`); no `canonical` handler, so a proven off-carrier
      // operand is rejected at boxing.
      signature:
        '(number, complex | infinity, complex | infinity, number?) -> number',
      nanBehavior: 'propagate',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: (ops, { numericApproximation, engine }) => {
        // The index and the derivative order are validated first: an
        // invalid index, or an unimplemented order r > 0, leaves the
        // application symbolic at every z and τ, infinite ones included.
        const j = asSmallInteger(ops[0]);
        if (j === null || j < 1 || j > 4) return undefined;
        if (ops[3] !== undefined && !ops[3].isSame(0)) return undefined;
        const held = symbolicAtInfinity([ops[1], ops[2]], engine);
        if (held !== undefined) return held ?? undefined;
        if (!shouldNumericize(numericApproximation, ops[1], ops[2]))
          return undefined;
        return applyN(
          [ops[1], ops[2]],
          (z, tau) =>
            jacobiTheta(
              j as 1 | 2 | 3 | 4,
              ops[1].engine.complex(z, 0),
              ops[1].engine.complex(tau, 0)
            ),
          undefined,
          (z, tau) => jacobiTheta(j as 1 | 2 | 3 | 4, z, tau)
        );
      },
    },

    DedekindEta: {
      description: 'Dedekind eta function η(τ), Im(τ) > 0.',
      wikidata: 'Q1187208',
      complexity: 8800,
      // The carrier is `complex | infinity`. η is defined on the upper
      // half-plane, whose only point at infinity is the cusp `i·∞`, which
      // the engine spells `~oo` (`i·∞` boxes to `~oo`): `η(~oo) = 0`, the
      // Fungrim identity 6b9935. A real infinity lies
      // outside the domain, like every real τ, and stays symbolic as they
      // do; an anonymous infinity is `NaN`. `NaN` propagates (explicit:
      // the carrier is not a subtype of `complex`); no `canonical`
      // handler, so a proven off-carrier operand is rejected at boxing.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: ([tau], { numericApproximation, engine }) => {
        const point = infinitePoint(tau);
        if (point === 'anonymous') return engine.NaN;
        if (point === '~oo') return engine.Zero;
        if (point !== undefined) return undefined;
        return shouldNumericize(numericApproximation, tau)
          ? applyN(
              [tau],
              (t) => dedekindEta(engine.complex(t, 0)),
              undefined,
              dedekindEta
            )
          : undefined;
      },
    },

    EisensteinE: {
      description:
        'Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) > 0.',
      complexity: 8800,
      // `s` is validated in the evaluate handler ('number' rather than
      // 'integer' so that rule-pattern wildcards — typed 'complex' — box; see
      // JacobiTheta). The `τ` slot takes the carrier `complex | infinity`,
      // with the same reading as `DedekindEta`'s: the cusp `i·∞` is spelled
      // `~oo` and `E_s(~oo) = 1` for a valid weight (the Fungrim identity
      // ad9ba2; the kernel already answered 1 there, by computing with the
      // nome q = 0), a real infinity stays symbolic like every real τ, and
      // an anonymous infinity is `NaN`. `NaN` propagates (explicit); no
      // `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature: '(number, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: (ops, { numericApproximation, engine }) => {
        // The weight is validated first: an invalid weight leaves the
        // application symbolic at every τ, an infinite τ included.
        const s = asSmallInteger(ops[0]);
        if (s === null || s < 2 || s % 2 !== 0) return undefined;
        const point = infinitePoint(ops[1]);
        if (point === 'anonymous') return engine.NaN;
        if (point === '~oo') return engine.One;
        if (point !== undefined) return undefined;
        if (!shouldNumericize(numericApproximation, ops[1])) return undefined;
        return applyN(
          [ops[1]],
          (tau) => eisensteinE(s, engine.complex(tau, 0)),
          undefined,
          (tau) => eisensteinE(s, tau)
        );
      },
    },

    ExpIntegralEi: {
      description: 'Exponential integral Ei(x) = PV ∫_{−∞}^x eᵗ/t dt.',
      wikidata: 'Q1361401',
      complexity: 7500,
      broadcastable: true,
      // The carrier is every number except NaN: Ei has a value at every
      // finite complex point (`Ei(0) = −∞`: the real part diverges while
      // the imaginary part stays bounded, the `Ln(0)` convention) and at
      // the signed infinities (`Ei(+∞) = +∞`, `Ei(−∞) = 0`, both verified
      // numerically: Ei(100) = 2.7·10⁴¹, Ei(−100) = −3.7·10⁻⁴⁶). At `~oo`
      // there is no value — `Ei(z) ≈ e^z/z` grows to the right and decays
      // to the left — so the answer is `NaN`, as it is for an anonymous
      // infinity. `NaN` propagates (explicit: the carrier is not a subtype
      // of `complex`); no `canonical` handler, so a proven off-carrier
      // operand is rejected at boxing.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // An argument on the EXTENDED real line maps to a value on the
      // extended real line: `Ei(0) = −∞` and `Ei(+∞) = +∞` are infinite, so
      // the claim has to spell the signed infinities out — the bare name
      // `real` denotes the finite reals and would exclude both. A finite
      // complex argument → finite complex value.
      type: (ops) => {
        const x = ops[0];
        if (!x || x.isNaN) return 'number';
        if (x.isExtendedReal === false)
          return x.isFinite === true ? 'complex' : 'number';
        return EXTENDED_REAL_TYPE;
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        // Exact special values, answered on both routes.
        const point = infinitePoint(x);
        if (point === '+oo') return ce.PositiveInfinity;
        if (point === '-oo') return ce.Zero;
        if (point !== undefined) return ce.NaN;
        if (x.im === 0 && x.isSame(0)) return ce.NegativeInfinity;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // Real args use the machine kernel; complex args the E₁-based kernel.
        return applyN([x], expIntegralEi, undefined, expIntegralEiComplex);
      },
    },

    LogIntegral: {
      description: 'Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x).',
      wikidata: 'Q853513',
      complexity: 7500,
      broadcastable: true,
      // The carrier is every number except NaN. On the non-negative real
      // axis li has the values below (`li(1) = −∞` is the pole, from both
      // sides; `li(+∞) = +∞`, li(10⁶) = 78628). `li(−∞)`: `li(x) =
      // Ei(ln x)` and `ln(−x) = ln x + iπ`, so both components of
      // `Ei(ln x + iπ) ≈ −e^(ln x)/ln x · (1 − iπ/ln x)` diverge
      // (li(−10⁴) = −1067 + 428i), an infinite value in a non-real
      // direction, which the engine spells `~oo`. At
      // `~oo` there is no value (`ln(~oo) = ~oo` and `Ei(~oo)` has none):
      // `NaN`, as for an anonymous infinity. A negative or non-real FINITE
      // argument stays symbolic (no kernel on that side of the axis, a
      // capability gap). `NaN` propagates (explicit: the carrier is not a
      // subtype of `complex`); no `canonical` handler, so a proven
      // off-carrier operand is rejected at boxing.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // li is real-valued only on the NON-NEGATIVE real axis, and there it
      // can be infinite: li(0) = 0, li(1) = −∞ (the pole), li(+∞) = +∞. So
      // the EXTENDED real line is the narrowest claim available on that
      // half-line — the bare name `real` denotes the finite reals and would
      // exclude the pole — and `real` alone is not claimable at all without
      // also proving x ≠ 1. Everywhere else the old unconditional `real` result
      // was wrong: for a negative real x, li(x) = Ei(ln x) with ln x complex,
      // so the value is complex, and `LogIntegral(NaN)` numericizes to NaN,
      // which `real` does not admit either. The gate narrows only on a proven
      // non-negative real, so an operand whose type decides neither realness
      // nor sign keeps the wide `number` — the non-finite typing convention.
      //
      // The claim is per-element: `LogIntegral` is broadcastable. The sign
      // fact describes the OPERAND as a whole, so it answers for the result
      // only when the operand is itself the single value being mapped — a
      // scalar. Every other operand takes its per-element sign from the
      // unwrapped element type: a collection (`list<real<0..>>`), and also a
      // `broadcastable<T>` operand, whose `collection` fact is `undefined`
      // because whether it is a collection is exactly what is not known.
      // Reading the operand's own sign there answers `undefined` for the
      // whole collection and needlessly widens `broadcastable<real<0..>>` to
      // `broadcastable<number>`.
      typeHandlerKind: 'types',
      type: ([x]) => {
        if (x === undefined) return 'number';
        const t = broadcastOperandType(x);
        // EXTENDED realness: `li(+∞) = +∞` is on the half-line the claim
        // covers, and a `+oo` argument does not match the bare (finite)
        // name `real`.
        if (typeFact(t, EXTENDED_REAL_TYPE) !== true) return 'number';
        const scalar = x.facts.collection === false && t === x.type;
        const sgn = scalar ? x.facts.sgn : signOfType(t);
        return nonNegativeSign(sgn) === true ? EXTENDED_REAL_TYPE : 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        const point = infinitePoint(x);
        if (point === '+oo') return ce.PositiveInfinity;
        if (point === '-oo') return ce.ComplexInfinity;
        if (point !== undefined) return ce.NaN;
        // li is real only for x ≥ 0; stay symbolic for complex/negative.
        if (x.im !== 0 || x.isNegative) return undefined;
        if (x.isSame(0)) return ce.Zero;
        if (x.isSame(1)) return ce.NegativeInfinity;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return applyN([x], logIntegral);
      },
    },
  },
];

/**
 * Exact closed-form reductions for `PolyLog(s, z)`, or `undefined` when none
 * applies (the numeric kernel then takes over). All identities are verified
 * against mpmath. The returned expression is *unevaluated* — the caller
 * evaluates it (so an inexact argument numericizes per the exactness
 * contract).
 *
 *   Liₛ(0) = 0                 (any s)
 *   Li₁(z)  = −ln(1 − z)
 *   Li₀(z)  = z/(1 − z)
 *   Li₋₁(z) = z/(1 − z)²
 *   Liₙ(1)  = ζ(n)             (integer n ≥ 2)
 *   Liₙ(−1) = (2^{1−n} − 1) ζ(n)   (integer n ≥ 2)
 */
function polylogReduce(
  engine: IComputeEngine,
  s: Expression,
  z: Expression
): Expression | undefined {
  // Liₛ(0) = 0 (for any order).
  if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.Zero;

  const sInt = asSmallInteger(s);

  // Order-specific elementary forms, valid for all z (symbolic or numeric).
  const oneMinusZ = (): Expression =>
    engine.function('Subtract', [engine.One, z]);
  if (sInt === 1) return engine.function('Ln', [oneMinusZ()]).neg();
  if (sInt === 0) return engine.function('Divide', [z, oneMinusZ()]);
  if (sInt === -1)
    return engine.function('Divide', [
      z,
      engine.function('Power', [oneMinusZ(), engine.number(2)]),
    ]);

  // z = ±1 with integer order n ≥ 2.
  if (sInt !== null && sInt >= 2 && isNumber(z) && z.im === 0) {
    if (z.isSame(1)) return engine.function('Zeta', [s]);
    if (z.isSame(-1))
      return engine.function('Multiply', [
        engine.function('Subtract', [
          engine.function('Power', [engine.number(2), engine.number(1 - sInt)]),
          engine.One,
        ]),
        engine.function('Zeta', [s]),
      ]);
  }
  return undefined;
}

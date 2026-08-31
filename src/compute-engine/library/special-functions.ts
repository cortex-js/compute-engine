import { SIGNED_INFINITY_TYPE } from '../../common/type/primitive.js';
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
import { EXTENDED_REAL_TYPE } from '../../common/type/primitive.js';
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

export const SPECIAL_FUNCTIONS_LIBRARY: SymbolDefinitions[] = [
  {
    EllipticK: {
      description:
        'Complete elliptic integral of the first kind K(m), parameter convention m = k².',
      wikidata: 'Q1080993',
      complexity: 8600,
      broadcastable: true,
      signature: '(number) -> number',
      // Real for m < 1, the +∞ pole at m = 1 (mirroring the `evaluate`
      // special case below), and a finite complex value for m > 1
      // (`K(2) = 1.311… − 1.311…i`).
      type: (ops) => boundedInverseTrigType(ops, ELLIPTIC_K_DOMAIN),
      evaluate: ([m], { numericApproximation, engine }) => {
        // K(1) = +∞ exactly (Fungrim 45b157)
        if (isNumber(m) && m.im === 0 && m.isSame(1))
          return engine.PositiveInfinity;
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
      signature: '(number, number?) -> number',
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
      signature: '(number, number) -> number',
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
      signature: '(number, number, number?) -> number',
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
          return shouldNumericize(numericApproximation, n, phi, m)
            ? applyN(
                [n, phi, m],
                ellipticPiIncomplete,
                undefined,
                ellipticPiIncompleteComplex
              )
            : undefined;
        }
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
      signature: '(number, number?) -> number',
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
        if (!shouldNumericize(numericApproximation, ...ops)) return undefined;
        const args = ops.length === 1 ? [engine.One, ops[0]] : [...ops];
        return applyN(args, agm, bigAgm, agmComplex);
      },
    },

    Hypergeometric2F1: {
      description: 'Gauss hypergeometric function ₂F₁(a, b; c; z).',
      wikidata: 'Q672619',
      complexity: 8700,
      signature: '(number, number, number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation, engine }) => {
        // ₂F₁(a, b; c; 0) = 1 exactly
        const z = ops[3];
        if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.One;
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
      signature: '(number, number, number, number, number, number) -> number',
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
        return shouldNumericize(numericApproximation, ...ops)
          ? applyN(ops, appellF1, undefined, appellF1Complex)
          : undefined;
      },
    },

    PolyLog: {
      description: 'Polylogarithm Liₛ(z) = Σ_{k≥1} zᵏ/kˢ.',
      wikidata: 'Q320067',
      complexity: 8700,
      signature: '(number, number) -> number',
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
      signature: '(number, number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation, engine }) => {
        // ₁F₁(a; b; 0) = 1 exactly
        const z = ops[2];
        if (isNumber(z) && z.im === 0 && z.isSame(0)) return engine.One;
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
      // 'integer' so that rule-pattern wildcards — typed 'complex' — box)
      signature: '(number, number, number, number?) -> number',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: (ops, { numericApproximation }) => {
        if (!shouldNumericize(numericApproximation, ops[1], ops[2]))
          return undefined;
        const j = asSmallInteger(ops[0]);
        if (j === null || j < 1 || j > 4) return undefined;
        // Derivative order r > 0 is not implemented: stay symbolic
        if (ops[3] !== undefined && !ops[3].isSame(0)) return undefined;
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
      signature: '(number) -> number',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: ([tau], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, tau)
          ? applyN(
              [tau],
              (t) => dedekindEta(engine.complex(t, 0)),
              undefined,
              dedekindEta
            )
          : undefined,
    },

    EisensteinE: {
      description:
        'Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) > 0.',
      complexity: 8800,
      // `s` is validated in the evaluate handler ('number' rather than
      // 'integer' so that rule-pattern wildcards — typed 'complex' — box; see
      // JacobiTheta).
      signature: '(number, number) -> number',
      // The handler itself stays: deleting it would activate the
      // no-handler fallback, which derives a NARROWER type than this
      // constant claim. Only its SHAPE moved to `'types'` — the claim reads
      // no operand, so the flip changes nothing it derives.
      typeHandlerKind: 'types',
      type: () => 'number',
      evaluate: (ops, { numericApproximation, engine }) => {
        if (!shouldNumericize(numericApproximation, ops[1])) return undefined;
        const s = asSmallInteger(ops[0]);
        if (s === null || s < 2 || s % 2 !== 0) return undefined;
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
      signature: '(number) -> number',
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
        // Exact special values (real axis).
        if (x.im === 0) {
          if (x.isSame(0)) return ce.NegativeInfinity;
          if (x.isInfinity) return x.isPositive ? ce.PositiveInfinity : ce.Zero;
        }
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
      signature: '(number) -> number',
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
        // li is real only for x ≥ 0; stay symbolic for complex/negative.
        if (!isNumber(x) || x.im !== 0 || x.isNegative) return undefined;
        if (x.isSame(0)) return ce.Zero;
        if (x.isSame(1)) return ce.NegativeInfinity;
        if (x.isInfinity && x.isPositive) return ce.PositiveInfinity;
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

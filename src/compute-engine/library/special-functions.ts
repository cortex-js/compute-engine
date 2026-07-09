import type { SymbolDefinitions } from '../global-types.js';
import { applyN, shouldNumericize } from '../boxed-expression/apply.js';
import { asSmallInteger } from '../boxed-expression/numerics.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import { numericTypeHandler } from './type-handlers.js';
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
export const SPECIAL_FUNCTIONS_LIBRARY: SymbolDefinitions[] = [
  {
    EllipticK: {
      description:
        'Complete elliptic integral of the first kind K(m), parameter convention m = k².',
      wikidata: 'Q1080993',
      complexity: 8600,
      broadcastable: true,
      signature: '(number) -> number',
      // K(1) = +∞ exactly — a *provably* non-finite (±∞) value, claimed as
      // `non_finite_number` per the non-finite typing convention (mirrors the
      // `evaluate` special case below).
      type: ([m]) =>
        isNumber(m) && m.im === 0 && m.isSame(1)
          ? 'non_finite_number'
          : numericTypeHandler([m]),
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
      type: (ops) => numericTypeHandler(ops),
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
      type: (ops) => numericTypeHandler(ops),
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
      type: (ops) => numericTypeHandler(ops),
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
      type: (ops) => numericTypeHandler(ops),
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
      type: (ops) => numericTypeHandler(ops),
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
      type: (ops) => numericTypeHandler(ops),
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

    Hypergeometric1F1: {
      description:
        'Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z).',
      wikidata: 'Q1331447',
      complexity: 8700,
      signature: '(number, number, number) -> number',
      type: (ops) => numericTypeHandler(ops),
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
      type: () => 'finite_number',
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
      type: () => 'finite_number',
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
      type: () => 'finite_number',
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
      signature: '(number) -> real',
      // Not finite_real: Ei(0) = −∞, Ei(±∞) = ±∞/0.
      type: () => 'real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        // Real argument only (machine-precision kernel); stay symbolic otherwise.
        if (!isNumber(x) || x.im !== 0) return undefined;
        if (x.isSame(0)) return ce.NegativeInfinity;
        if (x.isInfinity) return x.isPositive ? ce.PositiveInfinity : ce.Zero;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return applyN([x], expIntegralEi);
      },
    },

    LogIntegral: {
      description: 'Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x).',
      wikidata: 'Q853513',
      complexity: 7500,
      broadcastable: true,
      signature: '(number) -> real',
      // Not finite_real: li(1) = −∞.
      type: () => 'real',
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

import {
  PolynomialInvariantError,
  type PolynomialWork,
} from './exact-field.js';
import {
  latticeIndicatorPartition,
  type IndicatorConstraint,
} from './lattice-recombination.js';
import {
  NumberFieldResidueRing,
  type ResiduePolynomial,
} from './number-field-hensel.js';

/**
 * Equal columns of the retained indicator lattice cannot belong to different
 * number-field factors. Bounds apply to L times each power-basis coordinate
 * of F*g'/g, including integral coefficients outside the power order.
 */
export function numberFieldLatticePartition(
  defining: readonly bigint[],
  polynomial: ResiduePolynomial,
  factors: readonly ResiduePolynomial[],
  modulus: bigint,
  denominator: bigint,
  bounds: readonly (readonly bigint[])[],
  work: PolynomialWork,
  accept: (groups: number[][]) => boolean,
  observe?: (column: number, rank: number, operations: number) => void
): number[][] | null {
  function* constraints(probe: PolynomialWork): Iterable<IndicatorConstraint> {
    const R = new NumberFieldResidueRing(modulus, defining, probe);
    const logarithms = factors.map((g) => {
      const [quotient, remainder] = R.divrem(polynomial, g);
      if (remainder.length)
        throw new PolynomialInvariantError(
          'Invalid lifted number field divisor'
        );
      return R.mul(
        quotient,
        g.slice(1).map((c, i) => c.map((a) => (BigInt(i + 1) * a) % modulus))
      );
    });
    // Highest coefficients usually separate blocks with the least precision.
    for (let k = bounds.length - 2; k >= 0; k--)
      for (let j = defining.length - 2; j >= 0; j--) {
        probe.tick(factors.length);
        yield {
          bound: bounds[k][j],
          coefficients: logarithms.map(
            (g) => ((g[k]?.[j] ?? 0n) * denominator) % modulus
          ),
        };
      }
  }
  return latticeIndicatorPartition(
    factors.length,
    modulus,
    constraints,
    work,
    accept,
    observe
  );
}

import {
  splittingField,
  embedNumberFieldElement,
} from '../../src/compute-engine/polynomial/splitting-field';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';
import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field';

const poly = (cs: number[]) => cs.map((c) => q(BigInt(c)));
describe('Bounded certified splitting fields over the rationals', () => {
  test.each([
    [[-2, 0, 1], 2, 2],
    [[1, 0, 1], 2, 2],
    [[-2, 0, 0, 1], 6, 3],
    [[-1, 0, 0, 1], 2, 3],
    [[6, 0, -5, 0, 1], 4, 4],
  ])('constructs the field for %j', (input, degree, roots) => {
    const result = splittingField(poly(input as number[]));
    expect(result.status).toBe('complete');
    expect(result.field.degree).toBe(degree);
    expect(result.roots).toHaveLength(roots as number);
    for (const embedding of result.embeddings) {
      expect(
        embedNumberFieldElement(embedding, embedding.source.generator)
          .coefficients
      ).toEqual(embedding.generatorImage.coefficients);
    }
  });
  test('retains repeated roots and rational splitting fields', () => {
    const r = splittingField(poly([1, -2, 1]));
    expect(r.status).toBe('complete');
    expect(r.field.degree).toBe(1);
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0].multiplicity).toBe(2);
    expect(r.field.equals(r.roots[0].value, r.field.one)).toBe(true);
    expect(splittingField(poly([7])).roots).toEqual([]);
  });
  test('degree and work limits return incomplete, not a field claimed to split', () => {
    const r = splittingField(poly([-2, 0, 0, 1]), { maxFieldDegree: 3 });
    expect(r.status).toBe('incomplete');
    expect(r.reason).toBe('field-degree-limit');
    expect(r.field.degree).toBe(3);
    expect(r.roots).toEqual([]);
    expect(splittingField(poly([-2, 0, 1]), { maxOperations: 0 }).status).toBe(
      'incomplete'
    );
    expect(() => splittingField([])).toThrow('zero polynomial');
  });
  test('rejects invalid maps and forged field elements', () => {
    const field = RationalNumberField.create(poly([-2, 0, 1]));
    expect(() =>
      embedNumberFieldElement(
        {
          source: field,
          target: field,
          generatorImage: field.one,
        },
        field.generator
      )
    ).toThrow('defining polynomial');
    const forged = { field, coefficients: [q(0n), q(0n), q(1n)] };
    expect(() => field.mul(forged, field.one)).toThrow('explicit embedding');
    expect(() =>
      embedNumberFieldElement(
        {
          source: field,
          target: field,
          generatorImage: field.generator,
        },
        forged
      )
    ).toThrow('explicit embedding');
    expect(Object.isFrozen(field.one.coefficients[0])).toBe(true);
    expect(Object.isFrozen(field)).toBe(true);
    expect(() =>
      Reflect.construct(RationalNumberField, [poly([-1, 0, 1]), 0])
    ).toThrow('certify');
  });
});

import { ComputeEngine } from '../../src/compute-engine';

// The enclosure of an exact literal (`real<1.4..1.5>` for `√2`) is kept by
// the double value of the literal, its tier and its sign
// (`literalEnclosureType()`, `boxed-number.ts`). A second boxing of the
// same value reads the kept type, and two values with the same double but
// another tier or sign keep their own enclosure.

const ce = new ComputeEngine();

describe('CE-351: kept literal enclosures', () => {
  test('a second boxing of a radical gives the same enclosure', () => {
    const first = ce.expr(['Sqrt', 6]);
    const second = ce.expr(['Sqrt', 6]);
    expect(first.type.toString()).toBe('real<2.4..2.5>');
    expect(second.type.toString()).toBe('real<2.4..2.5>');
  });

  // The sign of a value on the double route is the sign of its double, so
  // `√2` and `−√2` have different keys also without the sign.
  test('a negative value has its own enclosure', () => {
    expect(ce.expr(['Sqrt', 2]).type.toString()).toBe('real<1.4..1.5>');
    expect(ce.expr(['Negate', ['Sqrt', 2]]).type.toString()).toBe(
      'real<-1.5..-1.4>'
    );
    expect(ce.expr(['Sqrt', 2]).type.toString()).toBe('real<1.4..1.5>');
  });

  test('the tier is part of the key', () => {
    // `1/3` and the decimal `0.333…` have the same double value.
    const decimal = ce.number('0.333333333333333333333333333');
    expect(decimal.re).toBe(1 / 3);
    expect(ce.expr(['Divide', 1, 3]).type.toString()).toBe(
      'rational<0.33..0.34>'
    );
    expect(decimal.type.toString()).toBe('real<0.33..0.34>');
    expect(ce.expr(['Divide', 1, 3]).type.toString()).toBe(
      'rational<0.33..0.34>'
    );
  });
});

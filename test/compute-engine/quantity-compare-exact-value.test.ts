import { ComputeEngine } from '../../src/compute-engine';

//
// A quantity whose unit is dimensionless is compared with a number. When
// the number is not a number literal as written (a symbol with a value, a
// sum of floats), its value is compared: the EXACT value when it has one,
// so that a difference smaller than the working precision is seen, and the
// value after `.N()` otherwise (the `compare` hook of the quantity kind
// reads the exact value of an operand, `QUANTITY_ARITHMETIC`,
// `src/compute-engine/library/quantity-kind.ts`).
//

describe('A QUANTITY COMPARED WITH THE EXACT VALUE OF A SYMBOL', () => {
  const ce = new ComputeEngine();
  // n = 1/2 − 10⁻³⁰: its value after `.N()` is 0.5.
  ce.assign('n', ce.box(['Subtract', ['Rational', 1, 2], ['Power', 10, -30]]));
  const q = ce.box(['Quantity', ['Rational', 1, 2], 'rad']);
  const n = ce.box('n');

  test('the order uses the exact value', () => {
    expect(q.isGreater(n)).toBe(true);
    expect(n.isLess(q)).toBe(true);
    expect(q.isLess(n)).toBe(false);
  });

  test('the equality uses the exact value', () => {
    expect(q.isEqual(n)).toBe(false);
    expect(n.isEqual(q)).toBe(false);
  });

  test('the operators agree with the methods', () => {
    expect(ce.box(['Greater', q, 'n']).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', q, 'n']).evaluate().symbol).toBe('False');
  });
});

describe('`.is()` WITH A NUMBER THAT IS NOT A LITERAL', () => {
  const ce = new ComputeEngine();
  const q = ce.box(['Quantity', 6, 'percent']);
  const s = ce.parse('0.05+0.01');

  test('`.is()` agrees with `.isEqual()`, in both directions', () => {
    expect(q.isEqual(s)).toBe(true);
    expect(q.is(s)).toBe(true);
    expect(s.is(q)).toBe(true);
  });

  test('a different value is not the quantity', () => {
    const t = ce.parse('0.05+0.02');
    expect(q.is(t)).toBe(false);
    expect(t.is(q)).toBe(false);
  });
});

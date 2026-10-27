// The decoded-payload cache on a boxed expression (`decodedPayload()`,
// `src/compute-engine/boxed-expression/decoded-payload.ts`). A value of a
// value kind stays a call of its head, so the hooks of the kind read its
// operands at each operation; the cache decodes them once for each boxed
// expression. The quantity hooks read the unit of a `Quantity` through it
// (`decodedUnit()`, `src/compute-engine/library/units.ts`).

import { ComputeEngine, decodedPayload } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  boxedToUnitExpression,
  decodedUnit,
} from '../../src/compute-engine/library/units';

const ce = new ComputeEngine();

let decodeCount = 0;
function decodeFirst(expr: Expression): number {
  decodeCount += 1;
  return expr.op1.re;
}

let otherCount = 0;
function decodeSecond(expr: Expression): number {
  otherCount += 1;
  return expr.op2.re;
}

let nullCount = 0;
function decodeNothing(_expr: Expression): null {
  nullCount += 1;
  return null;
}

describe('decodedPayload()', () => {
  test('decodes once for one boxed expression and two calls', () => {
    decodeCount = 0;
    const x = ce.box(['Tuple', 3, 4]);
    expect(decodedPayload(x, decodeFirst)).toBe(3);
    expect(decodedPayload(x, decodeFirst)).toBe(3);
    expect(decodeCount).toBe(1);
  });

  test('caches a null result too', () => {
    nullCount = 0;
    const x = ce.box(['Tuple', 5, 6]);
    expect(decodedPayload(x, decodeNothing)).toBeNull();
    expect(decodedPayload(x, decodeNothing)).toBeNull();
    expect(nullCount).toBe(1);
  });

  test('two decode functions on one expression are cached apart', () => {
    decodeCount = 0;
    otherCount = 0;
    const x = ce.box(['Tuple', 7, 8]);
    expect(decodedPayload(x, decodeFirst)).toBe(7);
    expect(decodedPayload(x, decodeSecond)).toBe(8);
    expect(decodedPayload(x, decodeFirst)).toBe(7);
    expect(decodedPayload(x, decodeSecond)).toBe(8);
    expect(decodeCount).toBe(1);
    expect(otherCount).toBe(1);
  });

  test('a different boxed expression that isSame() decodes again', () => {
    decodeCount = 0;
    const x = ce.box(['Tuple', 9, 10]);
    const y = ce.box(['Tuple', 9, 10]);
    expect(x).not.toBe(y);
    expect(x.isSame(y)).toBe(true);
    expect(decodedPayload(x, decodeFirst)).toBe(9);
    expect(decodedPayload(y, decodeFirst)).toBe(9);
    expect(decodeCount).toBe(2);
  });
});

describe('The decoded unit of a quantity', () => {
  test('is decoded once for each boxed unit', () => {
    const q = ce.box(['Quantity', 3, ['Divide', 'm', 's']]);
    const unit = q.op2;
    const first = decodedUnit(unit);
    expect(decodedUnit(unit)).toBe(first);
    expect(boxedToUnitExpression(unit)).toBe(first.unit);
    expect(first.unit).toEqual(['Divide', 'm', 's']);
    expect(first.dimension).toEqual([1, 0, -1, 0, 0, 0, 0, 0]);
    expect(first.scale).toBe(1);
  });

  test('a unit that is not in the unit table has no dimension', () => {
    const u = decodedUnit(ce.box(['Quantity', 3, 'foo']).op2);
    expect(u.unit).toBe('foo');
    expect(u.dimension).toBeNull();
    expect(u.scale).toBeNull();
  });

  test('the hooks read it correctly at a second evaluation', () => {
    const a = ce.box(['Quantity', 2, 'm']);
    const b = ce.box(['Quantity', 30, 'cm']);
    const sum = ce.function('Add', [a, b]);
    expect(sum.evaluate().toString()).toBe('2.3 m');
    // The second evaluation reads the cached units of `a` and `b`
    expect(sum.evaluate().toString()).toBe('2.3 m');
    const total = ce.function('Add', [sum.evaluate(), b]).evaluate();
    expect(total.toString()).toBe('2.6 m');
    expect(ce.function('Less', [b, a]).evaluate().json).toBe('True');
    expect(ce.function('Less', [a, b]).evaluate().json).toBe('False');
    expect(ce.function('Divide', [a, b]).evaluate().re).toBeCloseTo(
      2 / 0.3,
      12
    );
  });
});

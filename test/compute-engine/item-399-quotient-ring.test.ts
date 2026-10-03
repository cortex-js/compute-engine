import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('QuotientRing(Integers, n) is a finite collection (#399)', () => {
  const sizes = [1, 5, 1000000007];
  for (const n of sizes) {
    const ring = ce.box(['QuotientRing', 'Integers', n]);
    test(`Z/${n} is a finite, non-empty collection of count ${n}`, () => {
      expect(ring.isCollection).toBe(true);
      expect(ring.count).toBe(n);
      expect(ring.isFiniteCollection).toBe(true);
      expect(ring.isEmptyCollection).toBe(false);
    });
    test(`Count(Z/${n}) = ${n}`, () => {
      expect(ce.box(['Count', ring]).evaluate().json).toBe(n);
    });
  }

  test('Count of the parsed \\mathbb{Z}/5\\mathbb{Z} is 5', () => {
    const z5 = ce.parse('\\mathbb{Z}/5\\mathbb{Z}');
    expect(z5.json).toEqual(['QuotientRing', 'Integers', 5]);
    expect(z5.count).toBe(5);
    expect(ce.box(['Count', z5]).evaluate().json).toBe(5);
  });

  test('Count of the parsed \\mathbb{Z}_5 is 5', () => {
    const z5 = ce.parse('\\mathbb{Z}_5');
    expect(z5.isCollection).toBe(true);
    expect(ce.box(['Count', z5]).evaluate().json).toBe(5);
  });

  const inert: [string, unknown][] = [
    ['symbolic modulus', ['QuotientRing', 'Integers', 'n']],
    ['zero modulus', ['QuotientRing', 'Integers', 0]],
    ['negative modulus', ['QuotientRing', 'Integers', -3]],
    ['non-integer modulus', ['QuotientRing', 'Integers', 2.5]],
    ['non-Integers base', ['QuotientRing', 'RationalNumbers', 5]],
    ['Adjoin base', ['QuotientRing', ['Adjoin', 'Integers', ['Sqrt', 2]], 5]],
  ];
  for (const [name, json] of inert) {
    test(`${name} stays inert`, () => {
      const ring = ce.box(json as Expression);
      expect(ring.isCollection).toBe(false);
      expect(ring.count).toBeUndefined();
      expect(ce.box(['Count', ring]).evaluate().operator).toBe('Count');
    });
  }
});

describe('QuotientRing element type (#399)', () => {
  test('the element type is value: an element is a residue class', () => {
    expect(ce.parse('\\mathbb{Z}/5\\mathbb{Z}').type.toString()).toBe(
      'set<value>'
    );
    expect(ce.box(['QuotientRing', 'Integers', 'n']).type.toString()).toBe(
      'set<value>'
    );
  });
  test('a base other than Integers has no class value: unknown', () => {
    expect(ce.box(['QuotientRing', 'RationalNumbers', 5]).type.toString()).toBe(
      'set<unknown>'
    );
  });
});

// The classes are `ResidueClass` values (item-399-residue-class.test.ts), so
// ℤ/5ℤ is listed and decides the membership of a class. A bare integer is a
// representative of a class, not the class, and its membership is not decided.
describe('QuotientRing classes are listed (#399)', () => {
  const z5 = ce.box(['QuotientRing', 'Integers', 5]);
  test('enumerates', () => {
    expect(z5.isEnumerableCollection).toBe(true);
    expect([...z5.each()].map((x) => x.json)).toEqual(
      [0, 1, 2, 3, 4].map((k) => ['ResidueClass', k, 5])
    );
  });
  test('does not decide the membership of a bare integer', () => {
    expect(ce.box(['Element', 7, z5]).evaluate().operator).toBe('Element');
  });
  test('IsEmpty is False', () => {
    expect(ce.box(['IsEmpty', z5]).evaluate().json).toBe('False');
  });
  const walking: [string, unknown][] = [
    ['Union', ['Union', z5.json, ['Set', 1]]],
    ['Unique', ['Unique', z5.json]],
    ['Tally', ['Tally', z5.json]],
  ];
  for (const [name, json] of walking) {
    test(`${name} walks the classes`, () => {
      const result = ce.box(json as Expression).evaluate();
      expect(result.operator).not.toBe(name);
      expect(result.isValid).toBe(true);
    });
  }
});

import { ComputeEngine, setResidueClasses } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** A host's residue class: `ResidueClass(k, n)`. */
function engineWithClasses(): ComputeEngine {
  const engine = new ComputeEngine();
  setResidueClasses(engine, {
    element: (e, k, n) =>
      e.function('ResidueClass', [e.number(k), e.number(n)], {
        structural: true,
      }),
    modulusOf: (x: Expression) =>
      x.operator === 'ResidueClass' ? x.op2.re : undefined,
    type: 'expression',
  });
  return engine;
}

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
  test('set<unknown> without a class representation', () => {
    expect(ce.parse('\\mathbb{Z}/5\\mathbb{Z}').type.toString()).toBe(
      'set<unknown>'
    );
    expect(ce.box(['QuotientRing', 'Integers', 'n']).type.toString()).toBe(
      'set<unknown>'
    );
  });

  test('set<expression> with a registered representation', () => {
    const engine = engineWithClasses();
    expect(engine.parse('\\mathbb{Z}_5').type.toString()).toBe(
      'set<expression>'
    );
  });

  test('a representation is per engine', () => {
    engineWithClasses();
    expect(ce.parse('\\mathbb{Z}_5').type.toString()).toBe('set<unknown>');
  });
});

describe('QuotientRing without a class representation (#399)', () => {
  const z5 = ce.box(['QuotientRing', 'Integers', 5]);
  test('does not enumerate', () => {
    expect(z5.isEnumerableCollection).toBe(false);
    expect([...z5.each()]).toEqual([]);
  });
  test('does not decide membership', () => {
    expect(ce.box(['Element', 7, z5]).evaluate().operator).toBe('Element');
  });
});

describe('QuotientRing with a class representation (#399)', () => {
  const engine = engineWithClasses();
  const z5 = engine.parse('\\mathbb{Z}/5\\mathbb{Z}');
  const cls = (k: number, n: number) =>
    engine.function('ResidueClass', [engine.number(k), engine.number(n)], {
      structural: true,
    });

  test('iteration yields the 5 classes', () => {
    expect(z5.isEnumerableCollection).toBe(true);
    expect([...z5.each()].map((x) => x.toString())).toEqual(
      [0, 1, 2, 3, 4].map((k) => cls(k, 5).toString())
    );
  });

  test('membership is decided by the modulus', () => {
    expect(z5.contains(cls(2, 5))).toBe(true);
    expect(z5.contains(cls(2, 7))).toBe(false);
  });

  test('a bare integer is undecided, not a non-member', () => {
    expect(z5.contains(engine.number(7))).toBeUndefined();
  });

  test('Count still answers', () => {
    expect(engine.box(['Count', z5]).evaluate().json).toBe(5);
  });
});
